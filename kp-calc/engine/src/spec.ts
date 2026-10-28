// Спецификация к договору (Приложение №2, образец — docs/specification.md): черновик из строк расчёта.
// Только тексты и количества — цены здесь не считаются; стоимость берётся из compute (CalcResult.total).
// Менеджер потом правит всё вручную, описательные поля (фрезеровка, NCS, текстура) пустые.
import type { CalcInput, Settings } from './types.ts';
import type { CatalogIndex } from './calc.ts';
import { isLdspRow } from './calc.ts';

export interface SpecField { label: string; value: string }
export interface SpecSection { title: string; fields: SpecField[] }

/** Шапка: обязательные поля перед печатью — SPEC_REQUIRED. */
export interface SpecHeader {
  contractNo: string;
  contractDate: string;
  clientName: string;
  clientPhone: string;
  address: string;
  designer: string;
}

export interface SpecData {
  header: SpecHeader;
  /** Название изделия в спецификации. */
  title: string;
  sections: SpecSection[];
  /** Условия в подвале. */
  terms: string;
  /** Свободное поле: всё, что не вошло в разделы. */
  note: string;
}

export const SPEC_REQUIRED: { key: keyof SpecHeader; label: string }[] = [
  { key: 'contractNo', label: 'Номер договора' },
  { key: 'contractDate', label: 'Дата договора' },
  { key: 'clientName', label: 'ФИО клиента' },
  { key: 'address', label: 'Адрес объекта' },
];

export const SPEC_TERMS = 'Подъём на этаж при отсутствии грузового лифта оплачивается на месте. Установка и подключение подсветки, бытовой техники и сантехники оплачиваются по месту.';

/** Что не заполнено из обязательного (подписи полей). */
export function specMissing(h: Partial<SpecHeader>): string[] {
  return SPEC_REQUIRED.filter((f) => !String(h[f.key] ?? '').trim()).map((f) => f.label);
}

const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Черновик спецификации по расчёту. header — что известно заранее (клиент, телефон, менеджер). */
export function specDraft(input: CalcInput, idx: CatalogIndex, s: Settings, o: { title: string; header?: Partial<SpecHeader> }): SpecData {
  const rows = input.rows.filter((r) => r.qty > 0);
  const nameOf = (rowId: string | null | undefined, withGroup: boolean): string => {
    const r = input.rows.find((x) => x.id === rowId);
    if (!r) return '';
    if (r.realMaterial?.trim()) return r.realMaterial.trim();
    const f = idx.item(r.itemId);
    return f ? (withGroup ? `${f.group.name}, ${f.item.name}` : f.item.name) : '';
  };
  const uniqJoin = (xs: string[]) => [...new Set(xs.filter(Boolean))].join('; ');
  const cat = (r: CalcInput['rows'][number]) => idx.item(r.itemId)?.group;
  const inBlocks = (blocks: string[]) => rows.filter((r) => blocks.includes(r.block) && !r.own && !r.web);
  const ofCategory = (list: typeof rows, c: string) => uniqJoin(list.filter((r) => !r.linkTo && cat(r)?.category === c).map((r) => nameOf(r.id, true)));
  const backWall = (list: typeof rows) => uniqJoin(list.map((r) => {
    if (r.linkTo) {
      const src = input.rows.find((x) => x.id === r.linkTo);
      return r.realMaterial?.trim() || (src && isLdspRow(src, idx) ? `ЛДСП в цвет корпуса (${nameOf(src.id, true)})` : '');
    }
    return cat(r)?.name.toLowerCase().startsWith('хдф') ? nameOf(r.id, false) : '';
  }));
  const hwRows = inBlocks(['hw']);
  const hwOf = (test: (g: string) => boolean) => hwRows.filter((r) => test(cat(r)?.name.toLowerCase() ?? ''));
  const handles = uniqJoin(hwOf((g) => g.includes('ручк') || g.includes('gola')).map((r) => nameOf(r.id, false)));

  const part = (title: string, blocks: string[]): SpecSection => {
    const list = inBlocks(blocks);
    return {
      title,
      fields: [
        { label: 'Фасад (материал, цвет, артикул, толщина, фрезеровка)', value: ofCategory(list, 'Фасады') },
        { label: 'Отделка (матовая / глянец)', value: '' },
        { label: 'Обратная сторона фасада', value: '' },
        { label: 'Направление текстуры', value: '' },
        { label: 'Корпус (цвет, артикул, производитель)', value: ofCategory(list, 'ЛДСП корпус') },
        { label: 'Задняя стенка (ХДФ / ЛДСП, цвет)', value: backWall(list) },
        { label: 'Ручки (тип, количество, цвет)', value: handles },
      ],
    };
  };

  const sections: SpecSection[] = input.kind === 'kitchen'
    ? [part('Верхние модули', ['up']), part('Нижние модули', ['low'])]
    : [part('Изделие', ['body', 'facade'])];

  if (input.kind === 'kitchen') {
    const top = inBlocks(['top']);
    sections.push({
      title: 'Столешница, стеновая панель, плинтус',
      fields: [
        { label: 'Столешница (материал, цвет, артикул)', value: ofCategory(top, 'Столешницы') },
        { label: 'Стыковка столешницы (еврозапил / планка)', value: '' },
        { label: 'Стеновая панель (артикул, цвет)', value: ofCategory(top, 'Стеновые панели') },
        { label: 'Плинтус (цвет, артикул, материал)', value: uniqJoin([ofCategory(top, 'Плинтус'), ...hwOf((g) => g.startsWith('плинтус')).map((r) => nameOf(r.id, false))]) },
      ],
    });
  }

  // фурнитура: строка на позицию — «название — количество единица»; ручки уже в частях, цоколь — в прочем
  const unitOf = (r: CalcInput['rows'][number]) => cat(r)?.unit ?? 'шт';
  const fittings = hwRows.filter((r) => {
    const g = cat(r)?.name.toLowerCase() ?? '';
    return !g.startsWith('хдф') && !g.startsWith('цоколь') && !g.startsWith('плинтус');
  }).map((r) => ({ label: cat(r)?.name ?? 'Фурнитура', value: `${nameOf(r.id, false)} — ${fmtQty(r.qty)} ${unitOf(r)}` }));
  for (const r of rows.filter((x) => x.own || x.web)) {
    const name = (r.realMaterial?.trim() || r.own?.name || r.web?.name || '').trim();
    if (name) fittings.push({ label: 'Дополнительно', value: `${name} — ${fmtQty(r.qty)} ${r.own?.unit || r.web?.unit || 'шт'}` });
  }
  sections.push({ title: 'Фурнитура и комплектующие', fields: fittings.length ? fittings : [{ label: 'Фурнитура', value: '' }] });

  const L = input.light;
  const segs = L?.enabled ? L.segments.filter((x) => x.lengthM > 0) : [];
  const light = segs.length
    ? segs.map((x) => {
      const prof = s.light.profiles.find((p) => p.id === (x.profileId || L.profileId))?.name ?? '';
      const sw = s.light.switches.find((w) => w.id === x.switchId)?.name ?? '';
      return `${x.name || 'Зона'}: ${fmtQty(x.lengthM)} м.п.${prof ? `, ${prof.toLowerCase()}` : ''}${sw ? `, ${sw.toLowerCase()}` : ''}`;
    }).join('; ')
    : '';
  sections.push({
    title: 'Подсветка и прочее',
    fields: [
      { label: 'Подсветка (длина, профиль, выключатель)', value: light ? `${s.light.tape.name}. ${light}` : '' },
      { label: 'Цоколь (артикул, цвет, высота)', value: uniqJoin(hwOf((g) => g.startsWith('цоколь')).map((r) => nameOf(r.id, false))) },
      { label: 'Фасадные боковины, карнизные планки', value: '' },
      { label: 'Стекло (полки, фасады)', value: '' },
    ],
  });

  const h = o.header ?? {};
  return {
    header: {
      contractNo: h.contractNo ?? '', contractDate: h.contractDate ?? '', clientName: h.clientName ?? '',
      clientPhone: h.clientPhone ?? '', address: h.address ?? '', designer: h.designer ?? '',
    },
    title: o.title,
    sections,
    terms: SPEC_TERMS,
    note: '',
  };
}
