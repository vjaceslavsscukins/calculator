// Напоминания менеджеру в колокольчик (раз в час, каждое — один раз на КП):
// КП открыто клиентом 2+ дня назад, но не утверждено и без вопроса; срок КП заканчивается через 2 дня или раньше.
// Берём только последнюю версию каждого КП.
import type pg from 'pg';
import { kpNumber } from './kpdata.ts';

export const REMIND_OPEN_DAYS = 2;
export const REMIND_EXPIRE_DAYS = 2;

const LATEST = `k.version = (select max(k2.version) from kps k2 where k2.number = k.number)`;
const dmy = (d: unknown) => String(d).slice(0, 10).split('-').reverse().join('.');

/** Создаёт недостающие напоминания; возвращает, сколько добавлено. */
export async function runReminders(pool: pg.Pool): Promise<number> {
  let added = 0;
  const add = async (r: any, type: string, text: string) => {
    const { rowCount } = await pool.query(
      `insert into notifications (user_id, kp_id, type, text)
         select $1, $2, $3, $4 where not exists (select 1 from notifications where kp_id = $2 and type = $3)`,
      [r.manager_id, r.id, type, text]);
    added += rowCount ?? 0;
  };
  const { rows: opened } = await pool.query(
    `select k.id, k.number, k.version, cl.manager_id, cl.name as client_name, k.first_viewed_at from kps k join clients cl on cl.id = k.client_id
      where ${LATEST} and k.approved_at is null and k.first_viewed_at < now() - make_interval(days => $1)
        and k.valid_until >= current_date
        and not exists (select 1 from kp_events e where e.kp_id = k.id and e.type = 'question')`, [REMIND_OPEN_DAYS]);
  for (const r of opened) {
    await add(r, 'remind_open', `${kpNumber(r.number)} (${r.client_name}) клиент открыл ${dmy(r.first_viewed_at instanceof Date ? r.first_viewed_at.toISOString() : r.first_viewed_at)}, но не утвердил — позвоните, узнайте, что смущает`);
  }
  const { rows: expiring } = await pool.query(
    `select k.id, k.number, k.version, cl.manager_id, cl.name as client_name, k.valid_until from kps k join clients cl on cl.id = k.client_id
      where ${LATEST} and k.approved_at is null and k.sent_at is not null
        and k.valid_until between current_date and current_date + $1::int`, [REMIND_EXPIRE_DAYS]);
  for (const r of expiring) {
    await add(r, 'expiring', `Срок ${kpNumber(r.number)} (${r.client_name}) заканчивается ${dmy(r.valid_until)} — продлите: «Новая версия» с новой датой`);
  }
  return added;
}

/** Запуск по таймеру на сервере (не в тестах). */
export function startReminders(pool: pg.Pool, log: (m: string) => void = () => {}): () => void {
  const tick = () => runReminders(pool).then((n) => { if (n) log(`Напоминаний менеджерам: ${n}`); }).catch((e) => log(`Напоминания: ошибка ${e?.message ?? e}`));
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, 60 * 60_000);
  timer.unref?.(); first.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
