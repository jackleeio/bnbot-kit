import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { StripeService, PlanType } from '@/data/utils/stripe';

interface UseSubscriptionReturn {
  subscriptionTier: PlanType | null;
  hasSubscription: boolean;
  isLoading: boolean;
  refresh: () => void;
  refreshFromAPI: () => Promise<void>;
  openCustomerPortal: (returnUrl?: string) => Promise<void>;
}

export function useSubscription(): UseSubscriptionReturn {
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const [subscriptionTier, setSubscriptionTier] = useState<PlanType | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch from API
  const refreshFromAPI = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // httpOnly Cookie 由浏览器自动发送，不需要检查 token
    if (!isLoggedIn) return;

    try {
      setIsLoading(true);
      const data = await StripeService.getSubscriptionStatus();
      console.log('[useSubscription] API response:', data);

      const newTier = data.subscription?.plan_name || null;

      setSubscriptionTier(newTier);
      setHasSubscription(data.has_subscription);
    } catch (err) {
      console.error('[useSubscription] Failed to fetch from API:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn]);

  const openCustomerPortal = useCallback(async (returnUrl?: string) => {
    try {
      await StripeService.redirectToPortal(returnUrl);
    } catch (err: any) {
      console.error('Failed to open customer portal:', err);
      throw err;
    }
  }, []);

  // When logged in, fetch from API
  useEffect(() => {
    if (isLoggedIn && !isAuthLoading) {
      refreshFromAPI();
    } else if (!isLoggedIn && !isAuthLoading) {
      setSubscriptionTier(null);
      setHasSubscription(false);
      setIsLoading(false);
    }
  }, [isLoggedIn, isAuthLoading, refreshFromAPI]);

  return {
    subscriptionTier,
    hasSubscription,
    isLoading: isLoading || isAuthLoading,
    refresh: refreshFromAPI,
    refreshFromAPI,
    openCustomerPortal,
  };
}

export default useSubscription;
