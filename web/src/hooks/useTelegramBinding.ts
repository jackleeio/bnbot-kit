'use client';

import { useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

export interface TelegramBindingResponse {
  binding_code: string;
  deep_link: string;
  expires_in: number;
}

interface UseTelegramBindingOptions {
  agentId: string;
  onSuccess?: (data: TelegramBindingResponse) => void;
  onError?: (error: string) => void;
}

export const useTelegramBinding = (options: UseTelegramBindingOptions) => {
  const { agentId, onSuccess, onError } = options;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bindingCode, setBindingCode] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const requestBindingCode = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Use apiClient which automatically includes credentials (cookies)
      const data: TelegramBindingResponse = await apiClient.post(
        `/api/v1/agents/${agentId}/telegram-binding-code`,
        {}
      );

      setBindingCode(data.binding_code);
      setDeepLink(data.deep_link);
      setExpiresIn(data.expires_in);

      onSuccess?.(data);

      // Open the deep link in a new tab
      window.open(data.deep_link, '_blank', 'noopener,noreferrer');

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [agentId, onSuccess, onError]);

  return {
    isLoading,
    error,
    bindingCode,
    deepLink,
    expiresIn,
    requestBindingCode,
  };
};
