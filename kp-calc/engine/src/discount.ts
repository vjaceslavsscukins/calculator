// Лимит скидки по роли: менеджер — до discountMaxManager %, руководитель — до discountMaxHead %, владелец — без ограничения.
import type { Settings } from './types.ts';

export type DiscountRole = 'owner' | 'head' | 'manager';

export function discountLimit(role: DiscountRole, s: Pick<Settings, 'discountMaxManager' | 'discountMaxHead'>): number {
  return role === 'owner' ? 100 : role === 'head' ? s.discountMaxHead : s.discountMaxManager;
}

/** Текст отказа, если скидка больше лимита роли; null — можно. */
export function discountOverLimit(role: DiscountRole, pct: number, s: Pick<Settings, 'discountMaxManager' | 'discountMaxHead'>): string | null {
  const max = discountLimit(role, s);
  if (!(pct > max)) return null;
  return role === 'manager'
    ? `Скидка больше ${max} % — только руководитель. Попросите руководителя поставить её в расчёте`
    : `Скидка больше ${max} % — только владелец`;
}
