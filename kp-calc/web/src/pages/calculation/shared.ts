// Общее для экрана расчёта: черновик документа, id строк, группы прайса для блока и строки, «в цвет корпуса».
import {
  type BlockDef, type CalcInput, type Calculation, type CatalogGroupView, type CatalogView, type Pro100Line, type Row, type Status,
} from '../../api.ts';
import { pro100Fits } from '../../../../engine/src/pro100.ts';
import { type ComboItem } from '../../components/ItemCombo.tsx';

export interface Doc { title: string; status: Status; input: CalcInput; unparsed: Pro100Line[] }
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export interface Conflict { rev: number; updatedAt?: string; updatedBy?: string }

export const newId = () => {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
};

export function docOf(c: Calculation): Doc {
  const input: CalcInput = {
    kind: c.input?.kind ?? c.kind,
    rows: c.input?.rows ?? [],
    light: c.input?.light ?? { enabled: false, profileId: '', segments: [] },
    discountPct: c.input?.discountPct ?? 0,
    deliveryRub: c.input?.deliveryRub ?? null,
  };
  return { title: c.title, status: c.status, input, unparsed: c.unparsed ?? [] };
}

export const HDF_GROUP = 'ХДФ (задняя стенка)';

/** Строка ЛДСП корпуса, которую можно взять «в цвет корпуса» для задней стенки. */
export interface LdspLink { id: string; label: string }

/** Ссылка в выпадающем списке: «link:<id строки>». */
export const LINK = 'link:';

/** Группы для строки: у строки из PRO100 — только подходящие ей (у «Петли» — петли), иначе все группы блока. */
export function groupsForRow(r: Row, allowed: CatalogGroupView[]): CatalogGroupView[] {
  if (!r.pro100) return allowed;
  const fit = allowed.filter((g) => pro100Fits(r.pro100, g));
  return fit.length ? fit : allowed;
}

/** Группы прайса, из которых можно выбирать в блоке (BLOCKS движка: категории и отдельные группы фурнитуры). */
export function groupsFor(block: BlockDef | undefined, catalog: CatalogView | null): CatalogGroupView[] {
  if (!block || !catalog) return [];
  return catalog.groups.filter((g) => block.categories.includes(g.category) || (g.category === 'Фурнитура' && block.fittingGroups?.includes(g.name)));
}

export function isBackWall(r: Row, catalog: CatalogView | null): boolean {
  if (r.own || r.web) return false;
  if (r.linkTo || r.pro100 === 'ХДФ') return true;
  const g = r.itemId ? catalog?.groups.find((x) => x.items.some((it) => it.id === r.itemId)) : undefined;
  return g?.name === HDF_GROUP;
}

export const LINK_GROUP = '__link';
export const toCombo = (items: CatalogGroupView['items'], g: CatalogGroupView | undefined): ComboItem[] =>
  g ? items.map((it) => ({ id: it.id, name: it.name, group: g.name, status: it.status ?? undefined })) : [];
