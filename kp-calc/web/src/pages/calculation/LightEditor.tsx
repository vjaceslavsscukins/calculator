// Подсветка: участки (длина, профиль, включение); мощность, блоки питания и выключатели считает движок.
import { type CalcInput, type View } from '../../api.ts';
import { useApp } from '../../app.tsx';
import { NumInput } from '../../components/NumInput.tsx';
import { num } from '../../format.ts';
import type { Doc } from './shared.ts';

export function LightEditor({ doc, view, settings, onChange }: {
  doc: Doc; view: View | null; settings: ReturnType<typeof useApp>['settings']; onChange: (l: CalcInput['light']) => void;
}) {
  const light = doc.input.light;
  const L = settings?.light;
  const profiles = L?.profiles ?? [];
  const switches = L?.switches ?? [];
  // по умолчанию — первый настоящий выключатель, а не «Нет (напрямую)»
  const firstSwitch = switches.find((w) => w.id !== 'none')?.id ?? switches[0]?.id ?? '';
  // профиль выбирается у каждого участка; новый участок получает первый профиль из настроек
  // (LightInput.profileId остаётся в данных только для старых расчётов)
  const firstProfile = profiles[0]?.id ?? '';
  const lr = view?.light;
  const reserve = settings && 'lightReserve' in settings && typeof settings.lightReserve === 'number' ? settings.lightReserve : null;
  const setSeg = (k: number, p: Partial<CalcInput['light']['segments'][number]>) =>
    onChange({ ...light, segments: light.segments.map((s, j) => (j === k ? { ...s, ...p } : s)) });

  return (
    <div className="light" aria-label="Расчёт подсветки">
      <div className="light-head">
        <h3>Подсветка</h3>
        <label className="check">
          <input type="checkbox" checked={light.enabled} onChange={(e) => onChange({
            ...light, enabled: e.target.checked,
            profileId: light.profileId || profiles[0]?.id || '',
            // первый участок — под верхними шкафами, длина по столешнице из PRO100
            segments: e.target.checked && !light.segments.length ? [{ name: 'Под верхними шкафами', lengthM: doc.input.rows.find((r) => r.pro100 === 'Столешница')?.qty ?? 0, switchId: firstSwitch, profileId: firstProfile }] : light.segments,
          })} />
          Есть подсветка
        </label>
      </div>
      <p className="note">Вы задаёте участки: длину, профиль и включение у каждого участка. Мощность, блок питания и выключатели считаются сами; участки «Нет (напрямую к слаботочке)» — без выключателя и блока питания. Паз включён в цену профиля.</p>
      {light.enabled && (
        <>
          <div className="lgrid">
            <label>Лента<span className="fixed">{L?.tape.name ?? '—'}</span></label>
          </div>
          <div className="seglist">
            <div className="segrow seghead"><span>Участок</span><span>Длина, м</span><span>Профиль</span><span>Включение</span><span /></div>
            {light.segments.map((s, k) => (
              <div className="segrow" key={k}>
                <input className="in" aria-label="Участок" value={s.name} onChange={(e) => setSeg(k, { name: e.target.value })} />
                <NumInput className="in" aria-label="Длина, м" digits={2} value={s.lengthM} onValue={(n) => setSeg(k, { lengthM: Math.max(0, n) })} />
                <select className="in" aria-label="Профиль" value={s.profileId || light.profileId} onChange={(e) => setSeg(k, { profileId: e.target.value })}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="in" aria-label="Включение" value={s.switchId} onChange={(e) => setSeg(k, { switchId: e.target.value })}>
                  {switches.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button className="x" type="button" aria-label="Удалить участок" onClick={() => onChange({ ...light, segments: light.segments.filter((_, j) => j !== k) })}>×</button>
              </div>
            ))}
          </div>
          <button className="link" type="button" onClick={() => onChange({ ...light, segments: [...light.segments, { name: 'Новый участок', lengthM: 1, switchId: firstSwitch, profileId: firstProfile }] })}>+ участок</button>
          {lr && (
            <div className="lsum">
              <span>Лента <b>{num(lr.lengthM)} м</b></span>
              <span>Мощность <b>{num(lr.watt, 1)} Вт</b></span>
              <span>С запасом{reserve != null ? ` ${num(reserve * 100, 0)} %` : ''} <b>{num(lr.needWatt, 0)} Вт</b></span>
              <span>Блок питания <b>{lr.psuCount ? `${lr.psuCount > 1 ? `${lr.psuCount} × ` : ''}${lr.psuWatt} Вт` : 'не нужен'}</b></span>
              {!!lr.directM && <span>Напрямую к слаботочке <b>{num(lr.directM)} м</b></span>}
            </div>
          )}
          {lr?.warnings.map((w, k) => <div className="warn" key={k}>{w}</div>)}
        </>
      )}
    </div>
  );
}
