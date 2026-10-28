// Подсветка: менеджер задаёт зоны (длина, профиль, включение); мощность, блок питания и выключатели считаются здесь.
import { SWITCH_NONE } from './types.ts';
import type { LightInput, LightResult, RowResult, Settings } from './types.ts';

function lightRow(id: string, name: string, unit: string, qty: number, price: number, s: Settings): RowResult {
  const cost = qty * price, prod = cost * s.kProd;
  return { id, block: 'light', name, unit, qty, unitCost: price, cost, prod, retail: prod * s.kShop, costGroup: 'Подсветка', warnings: price > 0 ? [] : ['Нет цены'] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeLight(input: LightInput, s: Settings): LightResult {
  const L = s.light, segs = input.segments.filter((x) => x.lengthM > 0);
  const lengthM = r2(segs.reduce((a, x) => a + x.lengthM, 0));
  // Зоны «Нет (напрямую к слаботочке)» не получают ни выключателя, ни блока питания.
  const powered = segs.filter((x) => x.switchId !== SWITCH_NONE);
  const poweredM = r2(powered.reduce((a, x) => a + x.lengthM, 0));
  const directM = r2(lengthM - poweredM);
  const watt = poweredM * L.tape.wattPerM;
  const needWatt = watt * (1 + s.lightReserve);
  const sorted = [...L.psus].sort((a, b) => a.watt - b.watt);
  let psu = sorted.find((p) => p.watt >= needWatt), psuCount = 1;
  if (!psu && sorted.length) { psu = sorted[sorted.length - 1]; psuCount = Math.ceil(needWatt / psu.watt); }
  if (poweredM <= 0) psu = undefined;
  const rows: RowResult[] = [];
  const warnings: string[] = [];
  if (lengthM > 0) {
    rows.push(lightRow('light-tape', L.tape.name, 'м.п.', lengthM, L.tape.price, s));
    // Профиль у каждой зоны свой; одна строка на тип профиля с суммой длин.
    const byProfile = new Map<string, number>();
    for (const x of segs) {
      const prof = L.profiles.find((p) => p.id === (x.profileId || input.profileId)) ?? L.profiles[0];
      if (!prof) continue;
      byProfile.set(prof.id, r2((byProfile.get(prof.id) ?? 0) + x.lengthM));
    }
    for (const [id, m] of byProfile) {
      const prof = L.profiles.find((p) => p.id === id)!;
      rows.push(lightRow(`light-profile-${id}`, prof.name, 'м.п.', m, prof.price, s));
    }
    if (psu) rows.push(lightRow('light-psu', `Блок питания ${L.tape.voltage} В, ${psu.watt} Вт`, 'шт', psuCount, psu.price, s));
    const counts = new Map<string, number>();
    for (const x of powered) counts.set(x.switchId, (counts.get(x.switchId) ?? 0) + 1);
    for (const [id, n] of counts) {
      const sw = L.switches.find((w) => w.id === id);
      if (sw) rows.push(lightRow(`light-sw-${id}`, sw.name, 'шт', n, sw.price, s));
    }
    for (const x of segs) if (x.lengthM > L.tape.maxRunM) warnings.push(`Участок «${x.name}» ${x.lengthM} м длиннее ${L.tape.maxRunM} м: нужен второй ввод питания.`);
  }
  return { lengthM, directM, watt, needWatt, psuWatt: psu?.watt ?? 0, psuCount: psu ? psuCount : 0, warnings, rows };
}
