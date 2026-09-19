import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeName = 'paper' | 'slate';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const THEME_PREFERENCE_KEY = 'k3ncrypt-ui-theme';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const readThemePreference = (): ThemeName => {
  if (typeof window === 'undefined') return 'paper';
  const stored = window.localStorage.getItem(THEME_PREFERENCE_KEY);
  return stored === 'slate' ? 'slate' : 'paper';
};

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeName>(readThemePreference);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'slate' ? 'dark' : 'light';
    window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'slate' ? '#171b21' : '#eee9df');
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
