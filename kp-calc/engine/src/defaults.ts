// Значения по умолчанию. Владелец меняет их в админке; здесь — стартовые (решения владельца 27–28.10.2026).
import { SWITCH_NONE } from './types.ts';
import type { Settings } from './types.ts';

/** Название варианта «без выключателя»; вариант есть всегда, цена 0, не редактируется. */
export const SWITCH_NONE_NAME = 'Нет (подключение напрямую к слаботочке)';

export const DEFAULT_SETTINGS: Settings = {
  kProd: 1.8,
  kShop: 2,
  waste: 1.2,
  edgePerM2: 150,
  ldspSheetArea: 5.796,
  montagePct: 10,
  deliveryDefaultRub: 0,
  lightReserve: 0.3,
  roundTo: 100,
  light: {
    // Цены подсветки — пример, владелец задаёт свои. Максимальная длина участка — уточнить у поставщика ленты.
    tape: { name: 'Лента 24 В, 4000 K', price: 890, wattPerM: 14.4, voltage: 24, maxRunM: 10 },
    profiles: [
      { id: 'inset', name: 'Профиль врезной с рассеивателем (паз включён)', price: 1350 },
      { id: 'surface', name: 'Профиль накладной с рассеивателем', price: 780 },
    ],
    psus: [{ watt: 60, price: 1500 }, { watt: 100, price: 2100 }, { watt: 150, price: 2700 }, { watt: 200, price: 3300 }, { watt: 300, price: 4600 }],
    switches: [
      { id: SWITCH_NONE, name: SWITCH_NONE_NAME, price: 0 },
      { id: 'button', name: 'Кнопка врезная', price: 650 },
      { id: 'wave', name: 'Сенсор на взмах', price: 1200 },
      { id: 'door', name: 'Датчик открывания двери', price: 900 },
    ],
  },
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Приводит сохранённые настройки к текущей форме: старый deliveryPct («доставка и монтаж, %») → montagePct,
 * доставка по умолчанию 0 ₽, вариант выключателя «Нет» всегда первым с ценой 0.
 */
export function normalizeSettings(raw: any): Settings {
  const src = raw && typeof raw === 'object' ? raw : {};
  const { deliveryPct, ...rest } = src;
  const light = { ...DEFAULT_SETTINGS.light, ...(src.light ?? {}) };
  const switches = (Array.isArray(light.switches) ? light.switches : []).filter((w: any) => w?.id !== SWITCH_NONE);
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    montagePct: finite(src.montagePct) ? src.montagePct : finite(deliveryPct) ? deliveryPct : DEFAULT_SETTINGS.montagePct,
    deliveryDefaultRub: finite(src.deliveryDefaultRub) ? src.deliveryDefaultRub : DEFAULT_SETTINGS.deliveryDefaultRub,
    light: { ...light, switches: [{ id: SWITCH_NONE, name: SWITCH_NONE_NAME, price: 0 }, ...switches] },
  };
}
