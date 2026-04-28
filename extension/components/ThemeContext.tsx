import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Read X's current background color and infer light vs dark.
// X has three modes: Default (white), Dim (#15202B), Lights out (#000000).
// The cutoff at luma 140 catches Dim cleanly while leaving room for any
// off-white default backgrounds.
function detectXTheme(): Theme {
  const body = document.body;
  if (!body) {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const bg = window.getComputedStyle(body).backgroundColor;
  const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return 'light';
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  // ITU-R BT.601 luma — perceptual brightness 0..255
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 140 ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => detectXTheme());

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme]);

  // Mirror X's theme — observe body style/class mutations and re-detect.
  // X swaps the body background-color when the user changes Display
  // settings, so a single body-attribute observer is enough.
  useEffect(() => {
    const apply = () => {
      const next = detectXTheme();
      setThemeState((prev) => (prev === next ? prev : next));
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
