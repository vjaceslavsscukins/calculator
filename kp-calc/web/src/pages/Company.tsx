// «Компания» (владелец): постоянная часть КП — обложка (фото, слоган, адреса салонов, телефон), «Почему мы», условия, шаги.
// Изменения действуют на новые КП; сформированные КП не меняются.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Company } from '../api.ts';
import { ErrorNote } from '../components/Layout.tsx';
import { errText } from '../format.ts';

function Lines({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  return (
    <label className="field">{label}{hint && <small className="hint-s">{hint}</small>}
      <textarea className="area-d" rows={Math.max(3, value.length + 1)} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />
    </label>
  );
}

export function CompanyPage() {
  const [c, setC] = useState<Company | null>(null);
  const [rev, setRev] = useState(0);
  const [cover, setCover] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const apply = (r: { company: Company; rev: number; coverUrl: string | null }) => { setC(r.company); setRev(r.rev); setCover(r.coverUrl); };
  useEffect(() => { api.company().then(apply).catch((x) => setErr(errText(x))); }, []);
  if (!c) return <section className="view"><ErrorNote text={err} />{!err && <p className="foot">Загружаем…</p>}</section>;
  const set = (p: Partial<Company>) => { setC({ ...c, ...p }); setOk(null); };

  const save = async () => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
      apply(await api.saveCompany(rev, { ...c, includes: clean(c.includes), extra: clean(c.extra), terms: clean(c.terms), payment: clean(c.payment), steps: clean(c.steps) }));
      setOk('Сохранено. Новые КП получат эти данные; отправленные не меняются.');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 409 ? 'Данные уже изменили в другой вкладке. Обновите страницу.' : errText(x));
    } finally { setBusy(false); }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try { apply(await api.uploadCover(f)); setOk('Фото обложки загружено.'); } catch (x) { setErr(errText(x)); } finally { if (file.current) file.current.value = ''; }
  };

  return (
    <section className="view">
      <div><div className="eyebrow">Настройки · владелец</div><h1>Компания в КП</h1></div>
      <p className="lead">Постоянная часть коммерческого предложения: обложка, «Почему мы», гарантии и условия. Факты — только подтверждённые.</p>
      <ErrorNote text={err} />
      {ok && <div className="ok" role="status">{ok}</div>}
      <div className="adm">
        <div className="box">
          <h2>Обложка</h2>
          <div className="cover-pick">
            {cover ? <img src={cover} alt="Фото обложки" /> : <div className="cover-empty">Фото не загружено — на обложке будет графитовая заглушка</div>}
            <div className="actions">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
              <button className="btn small" type="button" onClick={() => file.current?.click()}>Загрузить фото</button>
              {cover && <button className="btn small" type="button" onClick={async () => { try { apply(await api.deleteCover()); } catch (x) { setErr(errText(x)); } }}>Убрать фото</button>}
            </div>
          </div>
          <label className="field">Название компании<input value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Слоган на обложке<input value={c.coverTitle} onChange={(e) => set({ coverTitle: e.target.value })} /></label>
          <label className="field">Телефон на обложке<input value={c.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="линия поддержки, необязательно" /></label>
          <div className="field">Адреса салонов
            {c.addresses.map((a, i) => (
              <div className="addr-row" key={i}>
                <input aria-label="Город" value={a.city} onChange={(e) => set({ addresses: c.addresses.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)) })} />
                <textarea aria-label="Адрес" className="area-d" rows={2} value={a.lines} onChange={(e) => set({ addresses: c.addresses.map((x, j) => (j === i ? { ...x, lines: e.target.value } : x)) })} />
                <button className="x big" type="button" aria-label="Убрать адрес" onClick={() => set({ addresses: c.addresses.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="link" type="button" onClick={() => set({ addresses: [...c.addresses, { city: '', lines: '' }] })}>+ салон</button>
          </div>
        </div>
        <div className="box">
          <h2>Почему мы</h2>
          <label className="field">Вводный абзац<textarea className="area-d" rows={4} value={c.lead} onChange={(e) => set({ lead: e.target.value })} /></label>
          <div className="field">Факты (крупно · подпись)
            {c.facts.map((f, i) => (
              <div className="pair" key={i}>
                <input aria-label="Факт" value={f.big} onChange={(e) => set({ facts: c.facts.map((x, j) => (j === i ? { ...x, big: e.target.value } : x)) })} />
                <input aria-label="Подпись" value={f.text} onChange={(e) => set({ facts: c.facts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button className="x big" type="button" aria-label="Убрать факт" onClick={() => set({ facts: c.facts.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="link" type="button" onClick={() => set({ facts: [...c.facts, { big: '', text: '' }] })}>+ факт</button>
          </div>
          <div className="field">Плашки (заголовок · текст)
            {c.boxes.map((f, i) => (
              <div className="pair" key={i}>
                <input aria-label="Заголовок" value={f.title} onChange={(e) => set({ boxes: c.boxes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input aria-label="Текст" value={f.text} onChange={(e) => set({ boxes: c.boxes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button className="x big" type="button" aria-label="Убрать плашку" onClick={() => set({ boxes: c.boxes.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="link" type="button" onClick={() => set({ boxes: [...c.boxes, { title: '', text: '' }] })}>+ плашка</button>
          </div>
        </div>
        <div className="box">
          <h2>Стоимость и условия</h2>
          <Lines label="Доставка и монтаж включают" hint="по пункту в строке" value={c.includes} onChange={(v) => set({ includes: v })} />
          <Lines label="Оплачивается отдельно" value={c.extra} onChange={(v) => set({ extra: v })} />
          <label className="field">«Не входит в стоимость изделия»<input value={c.notIncluded} onChange={(e) => set({ notIncluded: e.target.value })} /></label>
          <div className="pair2">
            <label className="field">Гарантия, крупно<input value={c.warrantyBig} onChange={(e) => set({ warrantyBig: e.target.value })} /></label>
            <label className="field">Гарантия, текст<input value={c.warrantyText} onChange={(e) => set({ warrantyText: e.target.value })} /></label>
          </div>
          <Lines label="Сроки" value={c.terms} onChange={(v) => set({ terms: v })} />
          <Lines label="Оплата" value={c.payment} onChange={(v) => set({ payment: v })} />
          <label className="field">Плашка под условиями<input value={c.fix} onChange={(e) => set({ fix: e.target.value })} /></label>
          <Lines label="Следующий шаг (01, 02…)" value={c.steps} onChange={(v) => set({ steps: v })} />
        </div>
      </div>
      <div className="actions"><button className="btn solid" type="button" onClick={save} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить данные компании'}</button></div>
    </section>
  );
}
