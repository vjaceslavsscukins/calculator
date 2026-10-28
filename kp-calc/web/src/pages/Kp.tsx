// КП в портале: ссылка для клиента, отправка (WhatsApp, Telegram, копия ссылки), «Открыть как клиент», PDF,
// просмотры клиента, события и версии. КП после формирования не меняется — правка = новая версия.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type KpDetail } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { dateTime, errText, rub } from '../format.ts';

const EVENT_TITLES: Record<string, string> = { open: 'Клиент открыл КП', approve: 'Клиент нажал «Утвердить проект»', question: 'Клиент задал вопрос', sent: 'Отправлено' };
const CHANNELS: Record<string, string> = { link: 'ссылка скопирована', whatsapp: 'WhatsApp', telegram: 'Telegram', pdf: 'PDF' };
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

/** Номер для wa.me: только цифры, 8XXXXXXXXXX → 7XXXXXXXXXX. */
export function waPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('8') ? `7${d.slice(1)}` : d.length === 10 ? `7${d}` : d;
}

export function KpPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { roundTo } = useApp();
  const [d, setD] = useState<KpDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.kp(id).then(setD).catch((x) => setErr(errText(x)));
  useEffect(() => { setD(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !d) return <section className="view"><div className="crumbs"><Link to="/clients">Клиенты</Link></div><ErrorNote text={err} /></section>;
  if (!d) return <section className="view"><p className="foot">Загружаем КП…</p></section>;
  const k = d.kp;
  const firstName = k.clientName.split(/\s+/)[0];
  const text = `Здравствуйте, ${firstName}! Подготовили для вас коммерческое предложение ${k.number}. Цена зафиксирована до ${dmy(k.validUntil)}.`;
  const mark = async (channel: 'link' | 'whatsapp' | 'telegram' | 'pdf') => {
    try { await api.kpSent(k.id, channel); load(); } catch (x) { setErr(errText(x)); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(k.url); setMsg('Ссылка скопирована.'); } catch {
      const el = document.getElementById('kp-url') as HTMLInputElement | null;
      el?.select();
      try { document.execCommand('copy'); setMsg('Ссылка скопирована.'); } catch { setMsg('Выделите ссылку и скопируйте вручную.'); }
    }
    mark('link');
  };
  const wa = waPhone(d.clientPhone);
  const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent(`${text}\n${k.url}`)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(k.url)}&text=${encodeURIComponent(text)}`;
  const s = d.snapshot;
  const t = s.totals;

  return (
    <section className="view">
      <div className="crumbs"><Link to="/clients">Клиенты</Link> / <Link to={`/clients/${k.clientId}`}><b>{k.clientName}</b></Link> / КП</div>
      <div className="head">
        <div><div className="eyebrow">Коммерческое предложение{k.version > 1 ? ` · версия ${k.version}` : ''}</div><h1>{k.number}</h1></div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => nav(`/clients/${k.clientId}/kp/new?base=${k.id}`)}>Новая версия</button>
          <a className="btn" href={`${k.url}?preview=1`} target="_blank" rel="noopener noreferrer">Открыть как клиент</a>
          <a className="btn" href={`${k.url}?preview=1&print=1&theme=light`} target="_blank" rel="noopener noreferrer" onClick={() => mark('pdf')}>Скачать PDF</a>
        </div>
      </div>
      <ErrorNote text={err} />

      <div className="kp-grid">
        <div className="box send">
          <h2>Отправить клиенту</h2>
          <input id="kp-url" className="code" readOnly value={k.url} onFocus={(e) => e.target.select()} aria-label="Ссылка на КП" />
          <div className="actions">
            <button className="btn solid" type="button" onClick={copy}>Скопировать ссылку</button>
            <a className="btn" href={waUrl} target="_blank" rel="noopener noreferrer" onClick={() => mark('whatsapp')} aria-disabled={!wa}>Отправить в WhatsApp</a>
            <a className="btn" href={tgUrl} target="_blank" rel="noopener noreferrer" onClick={() => mark('telegram')}>Отправить в Telegram</a>
          </div>
          {msg && <div className="ok" role="status">{msg}</div>}
          <p className="foot">WhatsApp откроется с номером клиента {d.clientPhone} и готовым текстом. В Telegram выберите чат клиента. Ссылка длинная и случайная: открыть КП можно только по ней.</p>
          <div className="stats">
            <span>Отправлено <b>{k.sentAt ? dateTime(k.sentAt) : 'ещё нет'}</b></span>
            <span>Открыто <b>{k.views ? `${k.views} раз, последний раз ${dateTime(k.lastViewedAt)}` : 'ещё не открывали'}</b></span>
            {k.approvedAt && <span>Утверждено клиентом <b>{dateTime(k.approvedAt)}</b></span>}
            <span>Действует до <b>{dmy(k.validUntil)}</b></span>
            <span>Вид <b>{k.theme === 'dark' ? 'тёмный' : 'светлый'}</b></span>
          </div>
        </div>

        <div className="panel">
          <h2>Состав и цена</h2>
          <table className="tab">
            <thead><tr><th>Изделие</th><th className="num">Было</th><th className="num">Со скидкой</th></tr></thead>
            <tbody>
              {s.items.map((it) => <tr key={it.calculationId}><td><Link to={`/calculations/${it.calculationId}`}>{it.title}</Link>{it.dims && <span className="sub">{it.dims}</span>}</td><td className="num">{rub(it.price.retail, s.roundTo || roundTo)}</td><td className="num">{rub(it.price.price, s.roundTo || roundTo)}</td></tr>)}
              {t.discount > 0 && <tr><td>Скидка</td><td className="num" colSpan={2}>−{rub(t.discount, s.roundTo)}</td></tr>}
              <tr><td>Монтаж</td><td className="num" colSpan={2}>{rub(t.montage, s.roundTo)}</td></tr>
              <tr><td>Доставка</td><td className="num" colSpan={2}>{rub(t.delivery, s.roundTo)}</td></tr>
              <tr className="sumrow"><td>Итого</td><td className="num" colSpan={2}>{rub(t.total, s.roundTo)}</td></tr>
            </tbody>
          </table>
          <p className="note">Цены зафиксированы в КП при формировании ({dateTime(k.createdAt)}{k.createdBy ? `, ${k.createdBy}` : ''}) и не меняются при изменении прайса.</p>
        </div>
      </div>

      <div className="kp-grid">
        <div className="box">
          <h2>Что делал клиент</h2>
          <table className="utab">
            <tbody>
              {d.events.map((e, i) => (
                <tr key={i}><td className="nowrap">{dateTime(e.at)}</td><td>{EVENT_TITLES[e.type] ?? e.type}{e.type === 'sent' ? `: ${CHANNELS[e.message] ?? e.message}` : e.message ? `: «${e.message}»` : ''}</td></tr>
              ))}
              {!d.events.length && <tr><td className="empty">Пока ничего. Отправьте ссылку клиенту.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="box">
          <h2>Версии {k.number}</h2>
          <table className="utab">
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id} className={v.id === k.id ? 'cur' : undefined}>
                  <td><Link className="link-dark" to={`/kp/${v.id}`}>Версия {v.version}</Link></td>
                  <td>{dateTime(v.createdAt)}</td>
                  <td className="num">{rub(v.total, roundTo)}</td>
                  <td>{v.views ? `открыто ${v.views}` : 'не открыто'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
