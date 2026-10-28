// Общее состояние портала: кто вошёл, справочники, тема.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, type Meta, type Settings, type SettingsPublic, type User } from './api.ts';

type Theme = 'dark' | 'light';

interface AppState {
  user: User | null;
  setUser: (u: User | null) => void;
  meta: Meta | null;
  settings: (Settings & { rev?: number }) | SettingsPublic | null;
  reloadSettings: () => Promise<void>;
  roundTo: number;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp вне AppProvider');
  return v;
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('kp-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch { /* хранилище недоступно — тема по умолчанию */ }
  return 'dark';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [settings, setSettings] = useState<AppState['settings']>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem('kp-theme', t); } catch { /* не сохраняем — не страшно */ }
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    if (!u) { setMeta(null); setSettings(null); }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then((r) => setUserState(r.user)).catch(() => setUserState(null)).finally(() => setChecked(true));
  }, [setUser]);

  const reloadSettings = useCallback(async () => {
    try { setSettings(await api.settings()); } catch { /* покажем ошибку на экране, где настройки нужны */ }
  }, []);

  useEffect(() => {
    if (!user) return;
    api.meta().then(setMeta).catch(() => setMeta(null));
    reloadSettings();
  }, [user, reloadSettings]);

  if (!checked) return null;

  const roundTo = settings?.roundTo && settings.roundTo > 0 ? settings.roundTo : 100;
  return (
    <Ctx.Provider value={{ user, setUser, meta, settings, reloadSettings, roundTo, theme, setTheme }}>
      {children}
    </Ctx.Provider>
  );
}
