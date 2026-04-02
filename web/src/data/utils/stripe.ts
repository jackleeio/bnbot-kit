import { HttpClient } from './client';
import { API_ENDPOINTS } from './endpoints';

export type PlanType = 'starter' | 'basic' | 'pro';
export type BillingInterval = 'month' | 'year';

const PLAN_DISPLAY_NAMES: Record<PlanType, string> = {
  starter: 'Free',
  basic: 'Premium',
  pro: 'Ultimate',
};

export function getPlanDisplayName(plan: PlanType): string {
  return PLAN_DISPLAY_NAMES[plan] || plan;
}

export interface CreateCheckoutRequest {
  plan: PlanType;
  interval: BillingInterval;
  success_url: string;
  cancel_url: string;
}

// Response for hosted checkout
export interface CheckoutResponse {
  checkout_url: string;
  session_id: string;
}

export interface Subscription {
  plan_name: PlanType;
  billing_interval: BillingInterval;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  current_period_end: string;
  cancel_at_period_end: boolean;
  credits_per_period: number;
}

export interface SubscriptionStatusResponse {
  has_subscription: boolean;
  subscription: Subscription | null;
}

export interface CreatePortalRequest {
  return_url: string;
}

export interface CreatePortalResponse {
  portal_url: string;
}

export interface CreditsResponse {
  credits: number;
  inviteCount?: number;
  invitation_code?: string;
  invite_link?: string;
}

export interface SessionStatusResponse {
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  customer_email?: string;
}

export class StripeService {
  /**
   * Create a Stripe Checkout Session for hosted mode
   * Returns checkout_url for redirecting to Stripe hosted page
   */
  static async createCheckoutSession(
    plan: PlanType,
    interval: BillingInterval
  ): Promise<CheckoutResponse> {
    const request: CreateCheckoutRequest = {
      plan,
      interval,
      success_url: `${window.location.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${window.location.origin}/#pricing`,
    };

    return HttpClient.post<CheckoutResponse>(
      API_ENDPOINTS.STRIPE_CREATE_CHECKOUT,
      request
    );
  }

  /**
   * Get session status after checkout completion
   */
  static async getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    return HttpClient.get<SessionStatusResponse>(
      `${API_ENDPOINTS.STRIPE_SESSION_STATUS}?session_id=${sessionId}`
    );
  }

  /**
   * Get the current user's subscription status
   */
  static async getSubscriptionStatus(): Promise<SubscriptionStatusResponse> {
    return HttpClient.get<SubscriptionStatusResponse>(
      API_ENDPOINTS.STRIPE_SUBSCRIPTION
    );
  }

  /**
   * Create a Stripe Customer Portal session for managing subscription
   */
  static async createPortalSession(
    returnUrl?: string
  ): Promise<CreatePortalResponse> {
    const request: CreatePortalRequest = {
      return_url: returnUrl || `${window.location.origin}/credits`,
    };

    return HttpClient.post<CreatePortalResponse>(
      API_ENDPOINTS.STRIPE_CREATE_PORTAL,
      request
    );
  }

  /**
   * Get user's credits balance
   */
  static async getCredits(): Promise<CreditsResponse> {
    return HttpClient.get<CreditsResponse>(API_ENDPOINTS.CREDITS);
  }

  /**
   * Open Stripe hosted Checkout page
   * Desktop: opens in new tab
   * Mobile: redirects in same window (to avoid popup blockers)
   */
  static async redirectToCheckout(
    plan: PlanType,
    interval: BillingInterval
  ): Promise<void> {
    const { checkout_url } = await this.createCheckoutSession(plan, interval);

    // Check if mobile device
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (isMobile) {
      window.location.href = checkout_url;
    } else {
      window.open(checkout_url, '_blank');
    }
  }

  /**
   * Redirect to Stripe Customer Portal
   */
  static async redirectToPortal(returnUrl?: string): Promise<void> {
    const { portal_url } = await this.createPortalSession(returnUrl);
    window.location.href = portal_url;
  }
}
