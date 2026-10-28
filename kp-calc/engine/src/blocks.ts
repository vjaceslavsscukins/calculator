// Блоки расчёта по виду изделия и какие группы прайса в них можно выбирать.
import type { ProductKind } from './types.ts';

export interface BlockDef {
  id: string;
  title: string;
  /** Категории прайса, из которых можно добавить строку в блок. */
  categories: string[];
  /** Группы категории «Фурнитура», если блок берёт не всю категорию. */
  fittingGroups?: string[];
}

const HW: BlockDef = { id: 'hw', title: 'Фурнитура', categories: ['Фурнитура'] };
const LIGHT: BlockDef = { id: 'light', title: 'Подсветка', categories: [] };
const FREE: BlockDef = { id: 'free', title: 'Свободные строки', categories: [] };

export const BLOCKS: Record<ProductKind, BlockDef[]> = {
  kitchen: [
    { id: 'up', title: 'Верхний блок', categories: ['ЛДСП корпус', 'Фасады'], fittingGroups: ['ХДФ (задняя стенка)'] },
    { id: 'low', title: 'Нижний блок', categories: ['ЛДСП корпус', 'Фасады'], fittingGroups: ['ХДФ (задняя стенка)'] },
    { id: 'top', title: 'Столешница, стеновая панель, плинтус', categories: ['Столешницы', 'Стеновые панели', 'Плинтус'] },
    HW, LIGHT, FREE,
  ],
  cabinet: [
    { id: 'body', title: 'Корпус', categories: ['ЛДСП корпус'], fittingGroups: ['ХДФ (задняя стенка)'] },
    { id: 'facade', title: 'Фасады', categories: ['Фасады'] },
    HW, LIGHT, FREE,
  ],
};

export const KIND_TITLES: Record<ProductKind, string> = {
  kitchen: 'Кухня',
  cabinet: 'Шкаф, тумба, другая корпусная мебель',
};

export function blocksOf(kind: ProductKind): BlockDef[] {
  return BLOCKS[kind] ?? BLOCKS.kitchen;
}
