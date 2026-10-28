// Общие типы движка. Деньги — в рублях без округления (округление только при выводе), размеры — в метрах и квадратных метрах.

export type PriceRule = 'sheet' | 'unit';

export interface CatalogItem {
  id: string;
  name: string;
  /** Для rule='sheet' — цена листа, иначе цена за единицу группы. */
  price: number;
  /** Например «нет в новом прайсе»: позиция скрыта из выбора, но старые расчёты её видят. */
  status?: string;
}

export interface CatalogGroup {
  id: string;
  category: string;
  name: string;
  unit: string;
  rule: PriceRule;
  /** Площадь листа, м² (для rule='sheet'). Для ЛДСП берётся из настроек. */
  sheetArea?: number;
  source?: string;
  items: CatalogItem[];
}

export interface Catalog {
  version?: number;
  groups: CatalogGroup[];
}

export interface LightPrices {
  tape: { name: string; price: number; wattPerM: number; voltage: number; maxRunM: number };
  profiles: { id: string; name: string; price: number }[];
  psus: { watt: number; price: number }[];
  switches: { id: string; name: string; price: number }[];
}

export interface Settings {
  /** Наценка производства, множитель (1,8 → ×1,8). */
  kProd: number;
  /** Наценка магазина (розница), множитель, применяется к производственной цене. */
  kShop: number;
  /** Отходы ЛДСП и плитных материалов, множитель. */
  waste: number;
  /** Кромка, ₽ на м² плитного материала. */
  edgePerM2: number;
  /** Площадь листа ЛДСП, м² (2800×2070 = 5,796). */
  ldspSheetArea: number;
  /** Монтаж, % от розницы мебели (скидка на него не действует). */
  montagePct: number;
  /** Доставка по умолчанию, ₽ (менеджер может задать свою сумму в расчёте). */
  deliveryDefaultRub: number;
  /** Запас мощности блока питания подсветки, доля (0,3 = 30 %). */
  lightReserve: number;
  /** Шаг округления при выводе, ₽. */
  roundTo: number;
  light: LightPrices;
}

export type ProductKind = 'kitchen' | 'cabinet';

export interface Row {
  id: string;
  block: string;
  /** Название строки PRO100, из которой пришло количество (null — строка добавлена вручную). */
  pro100?: string | null;
  /** Количество, которое дал PRO100 (для подсветки исправленного вручную). */
  qtyPro100?: number | null;
  qty: number;
  /** Позиция прайса (ценовая категория). */
  itemId?: string | null;
  /** Свободная строка: своё название, единица и цена (себестоимость за единицу). */
  own?: { name: string; unit: string; price: number } | null;
  /** «Реальный материал» для КП и спецификации, если в прайсе нет нужного. */
  realMaterial?: string | null;
  /**
   * Задняя стенка «ЛДСП в цвет корпуса»: id строки расчёта, где выбран ЛДСП.
   * Цена, единица и название берутся от позиции той строки, количество — своё.
   */
  linkTo?: string | null;
  /** Товар по ссылке с сайта (блок «Ссылки с сайтов»): price — цена закупки за штуку. */
  web?: { url: string; name: string; price: number; unit: string } | null;
  /** Без наценки (только свободная строка и ссылка с сайта): розница = себестоимость. Ставит руководитель или владелец. */
  noMarkup?: boolean;
}

/** Выключатель «Нет (подключение напрямую к слаботочке)»: ни выключателя, ни блока питания для зоны. */
export const SWITCH_NONE = 'none';

/** Зона подсветки. profileId не задан — берётся LightInput.profileId (старые расчёты). */
export interface LightSegment { name: string; lengthM: number; switchId: string; profileId?: string }
/** profileId — профиль по умолчанию для новых зон и для зон без своего профиля. */
export interface LightInput { enabled: boolean; profileId: string; segments: LightSegment[] }

export interface CalcInput {
  kind: ProductKind;
  rows: Row[];
  light: LightInput;
  /** Скидка, % от розницы мебели. */
  discountPct: number;
  /** Доставка, ₽ (null или не задано — Settings.deliveryDefaultRub). */
  deliveryRub?: number | null;
}

export interface RowResult {
  id: string;
  block: string;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  cost: number;
  prod: number;
  retail: number;
  costGroup: string;
  /** Пояснение к себестоимости, например «лист 6 090 ₽ ÷ 5,796 м² × 1,2 + 150». */
  costNote?: string;
  warnings: string[];
}

export interface LightResult {
  lengthM: number;
  /** Длина зон, подключённых напрямую к слаботочке (без выключателя и блока питания), м. */
  directM: number;
  /** Мощность зон с блоком питания, Вт (зоны «напрямую» не входят). */
  watt: number;
  needWatt: number;
  psuWatt: number;
  psuCount: number;
  warnings: string[];
  rows: RowResult[];
}

export interface CalcResult {
  rows: RowResult[];
  light: LightResult | null;
  blocks: { block: string; title: string; retail: number }[];
  /** Себестоимость по группам (ЛДСП корпус, Фасады, Столешницы и панели, Фурнитура, Подсветка, Свободные строки, Покупное по ссылкам). */
  costByGroup: Record<string, number>;
  cost: number;
  prod: number;
  retail: number;
  discount: number;
  furnitureAfterDiscount: number;
  /** Монтаж: % от розницы мебели, без скидки. */
  montage: number;
  /** Доставка суммой, без скидки. */
  delivery: number;
  /** Мебель со скидкой + монтаж + доставка. */
  total: number;
  /** Мебель со скидкой − себестоимость (монтаж и доставка не входят). */
  margin: number;
  warnings: string[];
}
