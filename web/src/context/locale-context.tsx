'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';

type Locale = 'en';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  messages: Record<string, unknown>;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

import enMessages from '../../messages/en.json';

function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : path;
}

export function LocaleProvider({
  children,
}: {
  children: React.ReactNode;
  initialLocale?: string;
}) {
  const locale: Locale = 'en';
  const messages = enMessages as Record<string, unknown>;

  const t = useCallback((key: string): string => {
    return getNestedValue(messages, key);
  }, [messages]);

  const value = useMemo(() => ({
    locale,
    setLocale: () => {},
    t,
    messages,
  }), [t, messages]);

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

export function useHomeTranslations(namespace: string) {
  const { t, locale, messages } = useLocaleContext();

  const tWithNamespace = useCallback((key: string): string => {
    return t(`${namespace}.${key}`);
  }, [t, namespace]);

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
