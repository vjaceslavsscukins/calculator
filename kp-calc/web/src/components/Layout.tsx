import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../app.tsx';
import { api, ROLE_TITLES } from '../api.ts';

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
          <span className="who">{user.firstName} {user.lastName}<small>{ROLE_TITLES[user.role]} · {user.cityName}</small></span>
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
