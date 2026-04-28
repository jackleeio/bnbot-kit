import React, { createContext, useContext, useEffect, useState } from 'react';
import { en, zh, Translations } from '../locales';

type Language = 'en' | 'zh';

interface LanguageContextType {
  language: Language;
  t: Translations;
  toggleLanguage: () => void;
  setLanguage: (lang: Language) => void;
}

const translations: Record<Language, Translations> = { en, zh };

// Mirror the X page's `<html lang>` so the extension UI tracks whatever
// language the user has set inside X's own settings — no per-extension
// preference, no user-facing toggle.
function detectXLanguage(): Language {
  const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  if (htmlLang.startsWith('zh')) return 'zh';
  if (htmlLang.startsWith('en')) return 'en';
  const navLang = (navigator.language || '').toLowerCase();
  return navLang.startsWith('zh') ? 'zh' : 'en';
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => detectXLanguage());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = detectXLanguage();
      setLanguageState((prev) => (prev === next ? prev : next));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, []);

  // Kept for compatibility — no UI calls these any more, but leaving them
  // exposes a manual override path for debugging in the console.
  const toggleLanguage = () => {
    setLanguageState((prev) => (prev === 'en' ? 'zh' : 'en'));
  };
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, t, toggleLanguage, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    console.warn('[LanguageContext] Provider not available, using fallback translations');
    return {
      language: 'en' as const,
      t: en,
      toggleLanguage: () => { },
      setLanguage: () => { },
    };
  }
  return context;
}
