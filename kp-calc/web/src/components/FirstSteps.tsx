// «Первые шаги» для нового сотрудника: четыре шага от клиента до отправленного КП. Отмечаются сами по данным,
// прячутся, когда всё пройдено, или по кнопке «Скрыть» (запоминается в этом браузере).
import { useEffect, useState } from 'react';
import { api } from '../api.ts';

const KEY = 'kp.firstSteps.hidden';
const hidden = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

export function FirstSteps({ clients }: { clients: number }) {
  const [off, setOff] = useState(hidden);
  const [state, setState] = useState<{ calcs: number; filled: number; kps: number; sent: number } | null>(null);
  useEffect(() => {
    if (off) return;
    Promise.all([api.calculations(), api.kps()]).then(([c, k]) => setState({
      calcs: c.calculations.length,
      filled: c.calculations.filter((x) => x.total > 0).length,
      kps: k.kps.length,
      sent: k.kps.filter((x) => x.sentAt).length,
    })).catch(() => setState(null));
  }, [off, clients]);
  if (off || !state) return null;
  const steps = [
    { done: clients > 0, title: 'Добавьте клиента', text: 'Кнопка «Новый клиент» справа: имя и телефон. Все расчёты и КП живут в карточке клиента.' },
    { done: state.calcs > 0, title: 'Создайте расчёт и вставьте PRO100', text: 'В карточке клиента «Новый расчёт» → «Вставить из PRO100»: скопируйте отчёт PRO100 (или две колонки из Excel) и нажмите «Разобрать».' },
    { done: state.filled > 0, title: 'Выберите материалы', text: 'В каждой строке — группа и артикул (можно искать: начните вводить «W960»). Справа «Проверьте» подскажет, что не выбрано. Сохраняется само.' },
    { done: state.sent > 0, title: 'Соберите и отправьте КП', text: '«Собрать КП» → проверьте тексты и картинку → «Сформировать КП» → «Отправить в WhatsApp» (или Telegram, Max). Когда клиент откроет КП, придёт уведомление.' },
  ];
  if (steps.every((s) => s.done)) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="box first-steps">
      <div className="fs-head">
        <h2>Первые шаги</h2>
        <button className="link" type="button" onClick={() => { try { localStorage.setItem(KEY, '1'); } catch { /* без памяти браузера — просто скрываем */ } setOff(true); }}>Скрыть</button>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'done' : i === next ? 'now' : undefined}>
            <b>{s.done ? '✓ ' : ''}{s.title}</b>
            {!s.done && <span>{s.text}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
