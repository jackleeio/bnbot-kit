'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type Locale = 'en' | 'zh';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  messages: Record<string, unknown>;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

// Import messages statically for instant access
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh.json';

const allMessages: Record<Locale, Record<string, unknown>> = {
  en: enMessages,
  zh: zhMessages,
};

// Helper to get nested value from object by dot notation key
function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path; // Return key if path not found
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : path;
}

export function LocaleProvider({
  children,
  initialLocale = 'en'
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Read locale from cookie on mount
  useEffect(() => {
    const cookieLocale = document.cookie
      .split('; ')
      .find(row => row.startsWith('NEXT_LOCALE='))
      ?.split('=')[1] as Locale | undefined;

    if (cookieLocale && (cookieLocale === 'en' || cookieLocale === 'zh')) {
      setLocaleState(cookieLocale);
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    if (newLocale === locale) return;

    // Set cookie for persistence
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;

    // Update state immediately - no server refresh needed!
    setLocaleState(newLocale);
  }, [locale]);

  const messages = useMemo(() => allMessages[locale], [locale]);

  const t = useCallback((key: string): string => {
    return getNestedValue(messages, key);
  }, [messages]);

  const value = useMemo(() => ({
    locale,
    setLocale,
    t,
    messages,
  }), [locale, setLocale, t, messages]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocaleContext() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocaleContext must be used within a LocaleProvider');
  }
  return context;
}

// Hook for homepage components - uses client-side context for instant switching
export function useHomeTranslations(namespace: string) {
  const { t, locale, messages } = useLocaleContext();

  const tWithNamespace = useCallback((key: string): string => {
    return t(`${namespace}.${key}`);
  }, [t, namespace]);

  // Also provide raw access for checking if key exists
  const tRaw = useCallback((key: string): unknown => {
    const fullKey = `${namespace}.${key}`;
    const keys = fullKey.split('.');
    let current: unknown = messages;

    for (const k of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[k];
    }

    return current;
  }, [namespace, messages]);

  return { t: tWithNamespace, tRaw, locale };
}
