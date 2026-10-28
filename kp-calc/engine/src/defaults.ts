// Значения по умолчанию. Владелец меняет их в админке; здесь — стартовые (решения владельца 27–28.10.2026).
import type { Settings } from './types.ts';

export const DEFAULT_SETTINGS: Settings = {
  kProd: 1.8,
  kShop: 2,
  waste: 1.2,
  edgePerM2: 150,
  ldspSheetArea: 5.796,
  deliveryPct: 10,
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
      { id: 'button', name: 'Кнопка врезная', price: 650 },
      { id: 'wave', name: 'Сенсор на взмах', price: 1200 },
      { id: 'door', name: 'Датчик открывания двери', price: 900 },
    ],
  },
};
