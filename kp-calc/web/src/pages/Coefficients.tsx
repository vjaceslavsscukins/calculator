import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Settings } from '../api.ts';
import { useApp } from '../app.tsx';
import { ErrorNote } from '../components/Layout.tsx';
import { NumInput } from '../components/NumInput.tsx';
import { errText, num, rub } from '../format.ts';

type Full = Settings & { rev: number };

export function CoefficientsPage() {
  const { reloadSettings } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [rev, setRev] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const r = (await api.settings()) as Full;
    const { rev: v, ...rest } = r;
    setS(rest as Settings); setRev(v); setDirty(false);
  };
  useEffect(() => { load().catch((x) => setErr(errText(x))); }, []);

  if (!s) return <section className="view"><h1>Коэффициенты</h1><ErrorNote text={err} />{!err && <p className="foot">Загружаем…</p>}</section>;

  const set = (p: Partial<Settings>) => { setS({ ...s, ...p }); setDirty(true); setMsg(null); };
  const setL = (p: Partial<Settings['light']>) => set({ light: { ...s.light, ...p } });

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.saveSettings(rev, s);
      setS(r.settings); setRev(r.rev); setDirty(false); setMsg('Сохранено. Новые расчёты считаются по этим коэффициентам; отправленные КП не меняются.');
      reloadSettings();
    } catch (x) {
      if (x instanceof ApiError && x.status === 409) setErr('Коэффициенты уже изменил кто-то другой. Нажмите «Загрузить заново» и внесите правку ещё раз.');
      else setErr(errText(x));
    } finally { setBusy(false); }
  };

  // Наглядный пример наценок для владельца (иллюстрация к полям, а не цена расчёта).
  const base = 100000, p1 = base * s.kProd, p2 = p1 * s.kShop;
  const field = (label: string, el: ReactNode) => <><label>{label}</label>{el}</>;
  const n = (v: number, on: (x: number) => void, digits = 3) => <NumInput digits={digits} value={v} onValue={on} />;

  return (
    <section className="view">
      <div className="head">
        <div><div className="eyebrow">Настройки · владелец</div><h1>Коэффициенты</h1></div>
        <div className="actions">
          {dirty && <button className="btn" type="button" onClick={() => load().catch((x) => setErr(errText(x)))}>Загрузить заново</button>}
          <button className="btn solid" type="button" onClick={save} disabled={busy || !dirty}>Сохранить коэффициенты</button>
        </div>
      </div>
      <ErrorNote text={err} />
      {msg && <div className="ok">{msg}</div>}
      <div className="adm">
        <div className="box">
          <h2>Наценки и расчёт</h2>
          <div className="kgrid">
            {field('Наценка производства, ×', n(s.kProd, (v) => set({ kProd: v })))}
            {field('Наценка магазина (розница), ×', n(s.kShop, (v) => set({ kShop: v })))}
            {field('Отходы ЛДСП, ×', n(s.waste, (v) => set({ waste: v })))}
            {field('Кромка, ₽ на м² ЛДСП', n(s.edgePerM2, (v) => set({ edgePerM2: v })))}
            {field('Площадь листа ЛДСП, м²', n(s.ldspSheetArea, (v) => set({ ldspSheetArea: v })))}
            {field('Монтаж, % от розницы', n(s.montagePct, (v) => set({ montagePct: Math.max(0, v) }), 2))}
            {field('Доставка по умолчанию, ₽', n(s.deliveryDefaultRub, (v) => set({ deliveryDefaultRub: Math.max(0, v) }), 0))}
            {field('Запас мощности подсветки, %', <NumInput digits={1} value={Math.round(s.lightReserve * 1000) / 10} onValue={(v) => set({ lightReserve: v / 100 })} />)}
            {field('Округление сумм при выводе, ₽', n(s.roundTo, (v) => set({ roundTo: Math.max(1, Math.round(v)) }), 0))}
          </div>
          <div className="example">
            <span>Пример: себестоимость <b>{rub(base, 1)}</b></span>
            <span>× {num(s.kProd)} производство → <b>{rub(p1, 1)}</b></span>
            <span>× {num(s.kShop)} магазин → <b>{rub(p2, 1)}</b> розница</span>
          </div>
        </div>

        <div className="box">
          <h2>Подсветка: лента</h2>
          <div className="kgrid">
            {field('Название ленты', <input value={s.light.tape.name} onChange={(e) => setL({ tape: { ...s.light.tape, name: e.target.value } })} />)}
            {field('Цена, ₽ за м', n(s.light.tape.price, (v) => setL({ tape: { ...s.light.tape, price: v } }), 2))}
            {field('Мощность, Вт на м', n(s.light.tape.wattPerM, (v) => setL({ tape: { ...s.light.tape, wattPerM: v } }), 2))}
            {field('Напряжение, В', n(s.light.tape.voltage, (v) => setL({ tape: { ...s.light.tape, voltage: v } }), 0))}
            {field('Наибольшая длина участка, м', n(s.light.tape.maxRunM, (v) => setL({ tape: { ...s.light.tape, maxRunM: v } }), 2))}
          </div>
          <p className="foot">Наибольшую длину участка уточните у поставщика ленты.</p>
        </div>

        <div className="box">
          <h2>Подсветка: профили</h2>
          <table className="utab">
            <thead><tr><th>Название</th><th className="num">₽ за м</th><th /></tr></thead>
            <tbody>
              {s.light.profiles.map((p, k) => (
                <tr key={p.id}>
                  <td><input className="cell" value={p.name} onChange={(e) => setL({ profiles: s.light.profiles.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td className="num"><NumInput className="cell num" digits={2} value={p.price} onValue={(v) => setL({ profiles: s.light.profiles.map((x, j) => (j === k ? { ...x, price: v } : x)) })} /></td>
                  <td><button className="x" type="button" aria-label="Удалить профиль" onClick={() => setL({ profiles: s.light.profiles.filter((_, j) => j !== k) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" type="button" onClick={() => setL({ profiles: [...s.light.profiles, { id: `p${Date.now().toString(36)}`, name: 'Новый профиль', price: 0 }] })}>+ профиль</button>
        </div>

        <div className="box">
          <h2>Подсветка: блоки питания</h2>
          <table className="utab">
            <thead><tr><th className="num">Мощность, Вт</th><th className="num">Цена, ₽</th><th /></tr></thead>
            <tbody>
              {s.light.psus.map((p, k) => (
                <tr key={k}>
                  <td className="num"><NumInput className="cell num" digits={0} value={p.watt} onValue={(v) => setL({ psus: s.light.psus.map((x, j) => (j === k ? { ...x, watt: v } : x)) })} /></td>
                  <td className="num"><NumInput className="cell num" digits={2} value={p.price} onValue={(v) => setL({ psus: s.light.psus.map((x, j) => (j === k ? { ...x, price: v } : x)) })} /></td>
                  <td><button className="x" type="button" aria-label="Удалить блок питания" onClick={() => setL({ psus: s.light.psus.filter((_, j) => j !== k) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" type="button" onClick={() => setL({ psus: [...s.light.psus, { watt: 0, price: 0 }] })}>+ блок питания</button>
        </div>

        <div className="box">
          <h2>Подсветка: выключатели</h2>
          <table className="utab">
            <thead><tr><th>Название</th><th className="num">Цена, ₽</th><th /></tr></thead>
            <tbody>
              {s.light.switches.map((w, k) => w.id === 'none' ? (
                <tr key={w.id}>
                  <td>{w.name}<span className="sub">есть всегда: без выключателя и блока питания</span></td>
                  <td className="num">0</td>
                  <td />
                </tr>
              ) : (
                <tr key={w.id}>
                  <td><input className="cell" value={w.name} onChange={(e) => setL({ switches: s.light.switches.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td className="num"><NumInput className="cell num" digits={2} value={w.price} onValue={(v) => setL({ switches: s.light.switches.map((x, j) => (j === k ? { ...x, price: v } : x)) })} /></td>
                  <td><button className="x" type="button" aria-label="Удалить выключатель" onClick={() => setL({ switches: s.light.switches.filter((_, j) => j !== k) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link" type="button" onClick={() => setL({ switches: [...s.light.switches, { id: `s${Date.now().toString(36)}`, name: 'Новый выключатель', price: 0 }] })}>+ выключатель</button>
        </div>

        <div className="box">
          <h2>Рендер по эскизу</h2>
          <label className="field">Базовый промт для нейросети
            <textarea className="area-d" rows={8} value={s.renderPrompt ?? ''} onChange={(e) => set({ renderPrompt: e.target.value })} aria-label="Базовый промт рендера" />
          </label>
          <p className="foot">К промту сервер добавляет название изделия, «Материалы и комплектация» из расчёта и комментарий менеджера «Что поправить». Пустое поле — промт по умолчанию. Ключ нейросети задаётся только в настройках сервера.</p>
        </div>
      </div>
      <p className="foot">Коэффициенты одни на всё и одинаковы для Москвы и Краснодара. Каждое изменение пишется в журнал.</p>
    </section>
  );
}
