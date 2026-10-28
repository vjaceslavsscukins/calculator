import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../app.tsx';
import { api, ROLE_TITLES, type Notice } from '../api.ts';
import { dateTime } from '../format.ts';

/** Колокольчик: клиент открыл КП впервые, утвердил проект, задал вопрос. Обновляется раз в 30 секунд. */
function Bell() {
  const nav = useNavigate();
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => { api.notifications().then((r) => { setItems(r.items); setUnread(r.unread); }).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const go = async (n: Notice) => {
    setOpen(false);
    if (!n.read) { await api.readNotifications([n.id]).catch(() => {}); load(); }
    if (n.kpId) nav(`/kp/${n.kpId}`);
  };
  return (
    <div className="bell-wrap" ref={box}>
      <button type="button" className="bell" aria-label={`Уведомления${unread ? `: новых ${unread}` : ''}`} aria-expanded={open} onClick={() => { setOpen((v) => !v); if (!open) load(); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.5" d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="bell-n">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-list" role="dialog" aria-label="Уведомления">
          <div className="bell-head"><b>Уведомления</b>{unread > 0 && <button className="link" type="button" onClick={async () => { await api.readNotifications().catch(() => {}); load(); }}>Прочитать все</button>}</div>
          {items.map((n) => (
            <button type="button" key={n.id} className={`bell-item${n.read ? '' : ' new'}`} onClick={() => go(n)}>
              <span>{n.text}</span><small>{dateTime(n.createdAt)}</small>
            </button>
          ))}
          {!items.length && <p className="foot">Пока ничего. Здесь появится, когда клиент откроет КП, утвердит проект или задаст вопрос.</p>}
        </div>
      )}
    </div>
  );
}

export function Logo({ className = 'logo' }: { className?: string }) {
  const { theme } = useApp();
  return <img className={className} src={theme === 'light' ? '/logo/cultura-group-logo-gray.svg' : '/logo/cultura-group-logo-white.svg'} alt="cultura group" />;
}

export function ThemeSwitch() {
  const { theme, setTheme } = useApp();
  return (
    <span className="seg" role="group" aria-label="Тема">
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Тёмная</button>
      <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Светлая</button>
    </span>
  );
}

export function Layout() {
  const { user, setUser } = useApp();
  const nav = useNavigate();
  if (!user) return null;
  const boss = user.role === 'owner' || user.role === 'head';

  const logout = async () => {
    try { await api.logout(); } catch { /* выходим в любом случае */ }
    setUser(null);
    nav('/login');
  };

  return (
    <div className="shell">
      <header className="top">
        <Logo />
        <span className="top-title">Калькулятор КП</span>
        <div className="top-tools">
          <ThemeSwitch />
          <Bell />
          <span className="who">{user.firstName} {user.lastName}<small>{ROLE_TITLES[user.role]}{user.cityName ? ` · ${user.cityName}` : ''}</small></span>
          <button type="button" className="btn small" onClick={logout}>Выйти</button>
        </div>
      </header>
      <nav className="side" aria-label="Разделы">
        <NavLink to="/clients">Клиенты</NavLink>
        <NavLink to="/calculations">Расчёты</NavLink>
        {boss && <NavLink to="/prices">Прайсы</NavLink>}
        {boss && <NavLink to="/audit">Журнал</NavLink>}
        {user.role === 'owner' && (
          <>
            <div className="side-cat">Настройки</div>
            <NavLink to="/settings/coefficients">Коэффициенты</NavLink>
            <NavLink to="/settings/users">Пользователи</NavLink>
            <NavLink to="/settings/company">Компания в КП</NavLink>
          </>
        )}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorNote({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <div className="err" role="alert">{text}</div>;
}
