// Только вывод чисел. Округление — при выводе (CLAUDE.md, правило 7); суммы считает сервер.
const NBSP = ' ';

const group = (n: number, digits = 0) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/\s/g, NBSP);

/** Сумма: округление до шага settings.roundTo, «125 400 ₽». */
export function rub(n: number | null | undefined, step = 100): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = step > 0 ? step : 1;
  const r = Math.round(n / s) * s;
  return `${group(r === 0 ? 0 : r)}${NBSP}₽`;
}

/** Цена за единицу — до рубля (шаг округления сумм к ней не применяется, чтобы не искажать прайс). */
export const rubUnit = (n: number | null | undefined) => rub(n, 1);

export const num = (n: number | null | undefined, digits = 2) => (n == null || !Number.isFinite(n) ? '—' : group(n, digits));

/** Разбор числа из поля ввода: запятая допускается. */
export function parseNum(v: string): number {
  const x = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : 0;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function time(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так. Повторите через минуту.');
