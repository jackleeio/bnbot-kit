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

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const savedLang = localStorage.getItem('bnbot-language');
    if (savedLang === 'en' || savedLang === 'zh') {
      return savedLang;
    }
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith('zh')) {
      return 'zh';
    }
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('bnbot-language', language);
  }, [language]);

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
    // Fallback for cases where provider is not available (e.g., HMR, extension reload)
    // Return English translations with no-op functions to prevent crashes
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
