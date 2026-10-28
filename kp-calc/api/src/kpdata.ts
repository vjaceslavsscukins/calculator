// Данные КП: постоянная часть («Компания» — обложка, адреса, факты, условия) и форма снимка КП.
// Факты — из подтверждённых владельцем заметок (docs/kp-format.md): гарантия 10 лет, 55 рабочих дней, 60 % / 40 %.
import type { KpItemPrice, KpTotals } from '../../engine/src/index.ts';
import { HttpError } from './view.ts';

export interface Company {
  name: string;
  /** Слоган на обложке (точка в конце — бордовая). */
  coverTitle: string;
  addresses: { city: string; lines: string }[];
  /** Телефон линии поддержки на обложке; пусто — не показываем. */
  phone: string;
  lead: string;
  facts: { big: string; text: string }[];
  boxes: { title: string; text: string }[];
  includes: string[];
  extra: string[];
  notIncluded: string;
  warrantyBig: string;
  warrantyText: string;
  terms: string[];
  payment: string[];
  fix: string;
  steps: string[];
  /** Фото обложки (картинка kind = 'cover'); null — заглушка. */
  coverImageId: string | null;
}

export const DEFAULT_COMPANY: Company = {
  name: 'Культура Групп',
  coverTitle: 'Сделано с культурой',
  addresses: [
    { city: 'Москва', lines: 'ул. Ленинская Слобода, 26\nМебельный центр Roomer, 3 этаж' },
    { city: 'Краснодар', lines: 'ул. Пашковская, 92\nул. Евдокимовская, 125' },
  ],
  phone: '',
  lead: 'Мы делаем мебель на собственном производстве в Краснодаре. Перед отгрузкой каждое изделие проходит контрольную сборку, поэтому к вам оно приезжает собранными модулями, упакованными в плёнку и картон.',
  facts: [
    { big: '5000+', text: 'изделий для 1700+ клиентов с 2019 года' },
    { big: '10 лет', text: 'гарантии, прописанной в договоре' },
    { big: '1000 м²', text: 'собственного производства, стаж мастеров от 10 лет' },
    { big: 'Blum · Hettich', text: 'и Salice — фурнитуру без бренда не ставим' },
  ],
  boxes: [
    { title: 'Без ограничений', text: 'Любые цвета и размеры без доплаты за нестандарт.' },
    { title: 'Проект до оплаты', text: 'Предварительный проект и визуализацию делаем до первой оплаты.' },
    { title: 'Один менеджер', text: 'Один проектный менеджер и общий чат с вами до конца проекта.' },
  ],
  includes: ['доставку и подъём на грузовом лифте', 'установку собранных модулей на месте'],
  extra: ['подъём без грузового лифта — по прайсу', 'подключение техники, сантехники и подсветки — по месту'],
  notIncluded: 'поэтажный подъём длинномеров без лифта — по действующему прайсу.',
  warrantyBig: '10 лет',
  warrantyText: 'Прописана в договоре. Обращение фиксируем сразу, на объект выезжает сервисный менеджер.',
  terms: [
    'по договору — 55 рабочих дней с подтверждения материалов и финальных чертежей',
    'изменения в проекте возможны, пока элемент не изготовлен',
    'монтаж — в согласованный с вами день после готовности',
  ],
  payment: ['60 % — после согласования проекта', '40 % — когда мебель готова, до отгрузки', 'работаем с юрлицами, в том числе с НДС'],
  fix: 'Все условия фиксируются в договоре перед запуском проекта в производство.',
  steps: [
    'Вы утверждаете материалы и декоры — образцы можно посмотреть в шоуруме.',
    'Мы приезжаем на замер, готовим эскиз и спецификацию, вы их подписываете.',
    'Вы вносите 60 % — проект уходит технологу и в производство.',
    'Контрольная сборка, оплата 40 %, доставка и монтаж.',
  ],
  coverImageId: null,
};

const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max = 12, len = 300) => (Array.isArray(v) ? v.map((x) => s(x, len)).filter(Boolean).slice(0, max) : []);

/** Сохранённые данные компании → полная форма (недостающее — по умолчанию). */
export function normalizeCompany(raw: any): Company {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { ...DEFAULT_COMPANY, ...r, coverImageId: typeof r.coverImageId === 'string' ? r.coverImageId : null };
}

/** Проверка правки владельца. coverImageId меняется только загрузкой фото. */
export function cleanCompany(raw: any, coverImageId: string | null): Company {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Нет данных компании');
  const pairs = <T>(v: unknown, f: (x: any) => T | null, max = 8) => (Array.isArray(v) ? v.map(f).filter((x): x is T => !!x).slice(0, max) : []);
  return {
    name: s(raw.name, 100) || DEFAULT_COMPANY.name,
    coverTitle: s(raw.coverTitle, 100) || DEFAULT_COMPANY.coverTitle,
    addresses: pairs(raw.addresses, (x) => (s(x?.city, 60) ? { city: s(x.city, 60), lines: s(x?.lines, 300) } : null), 6),
    phone: s(raw.phone, 40),
    lead: s(raw.lead, 1000),
    facts: pairs(raw.facts, (x) => (s(x?.big, 40) ? { big: s(x.big, 40), text: s(x?.text, 200) } : null), 6),
    boxes: pairs(raw.boxes, (x) => (s(x?.title, 80) ? { title: s(x.title, 80), text: s(x?.text, 300) } : null), 6),
    includes: list(raw.includes),
    extra: list(raw.extra),
    notIncluded: s(raw.notIncluded, 500),
    warrantyBig: s(raw.warrantyBig, 30),
    warrantyText: s(raw.warrantyText, 500),
    terms: list(raw.terms),
    payment: list(raw.payment),
    fix: s(raw.fix, 500),
    steps: list(raw.steps, 6),
    coverImageId,
  };
}

export interface KpSnapshotItem {
  calculationId: string;
  kind: 'kitchen' | 'cabinet';
  title: string;
  /** Габариты «Высота … · длина … · глубина …» или состав. */
  dims: string;
  about: string;
  materials: { role: string; value: string }[];
  benefits: string[];
  image: { id: string; kind: 'sketch' | 'render' } | null;
  price: KpItemPrice;
}

export interface KpSnapshot {
  number: string;
  version: number;
  createdAt: string;
  validUntil: string;
  theme: 'dark' | 'light';
  roundTo: number;
  client: { name: string; city: string };
  manager: { name: string; position: string; phone: string; city: string };
  company: Company;
  items: KpSnapshotItem[];
  totals: KpTotals;
}

export const kpNumber = (n: number) => `КП-${String(n).padStart(4, '0')}`;
