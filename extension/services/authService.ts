// Authentication Service
// Handles Google OAuth and email verification

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

/**
 * Check if the extension context is still valid
 * Returns false if the extension was updated/reloaded
 */
function isExtensionContextValid(): boolean {
  try {
    // Attempting to access chrome.runtime.id will throw if context is invalidated
    return !!(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Dispatch a custom event to notify the app about auth state changes
 */
function dispatchAuthEvent(type: 'session_expired' | 'logout', detail?: any): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bnbot:auth', { detail: { type, ...detail } }));
  }
}

export type SubscriptionTier = 'free' | 'starter' | 'basic' | 'pro';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid';
export type BillingInterval = 'month' | 'year';

export interface Subscription {
  id: string;
  plan_name: SubscriptionTier;
  billing_interval: BillingInterval;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  credits_per_period: number;
  created_at: string;
}

export interface SubscriptionResponse {
  has_subscription: boolean;
  subscription?: Subscription;
}

export interface User {
  id?: string;
  email: string;
  name?: string;
  full_name?: string;
  avatar?: string;
  credits?: number;
  x_balance?: number;
  subscription_tier?: SubscriptionTier;
  invitation_code?: string;
  is_active?: boolean;
  is_superuser?: boolean;
  is_verified?: boolean;
  google_id?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user?: User;
}

class AuthService {
  /**
   * Storage keys for tokens in chrome.storage
   */
  private static readonly ACCESS_TOKEN_KEY = 'accessToken.bnbot';
  private static readonly REFRESH_TOKEN_KEY = 'refreshToken.bnbot';
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * Save tokens to chrome.storage
   */
  private async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    console.log('[AuthService] Saving tokens to chrome.storage');

    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        await chrome.storage.local.set({
          [AuthService.ACCESS_TOKEN_KEY]: accessToken,
          [AuthService.REFRESH_TOKEN_KEY]: refreshToken,
        });
        console.log('[AuthService] Tokens saved successfully');
      } catch (error) {
        console.error('[AuthService] Failed to save tokens:', error);
      }
    }
  }

  /**
   * Helper to process login response and save user
   */
  private async processLoginResponse(data: LoginResponse, emailFallback: string): Promise<User> {
    console.log('[AuthService] Processing login response');

    // Save tokens from response body to chrome.storage
    if (data.access_token && data.refresh_token) {
      await this.saveTokens(data.access_token, data.refresh_token);
    } else {
      console.warn('[AuthService] No tokens in login response');
    }

    // Create user object
    const user: User = {
      ...data.user,
      email: data.user?.email || emailFallback,
      name: data.user?.full_name || data.user?.name || '',
      full_name: data.user?.full_name,
    };

    console.log('[AuthService] Saving user information:', {
      email: user.email
    });

    await this.saveUser(user);
    return user;
  }

  /**
   * Google OAuth login via background script
   */
  async googleLogin(inviteCode?: string): Promise<User> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('请在 Chrome 扩展环境中使用');
    }

    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
      throw new Error('扩展已更新，请刷新页面后重试');
    }

    // Get id_token from background script
    const oauthResult = await new Promise<{ id_token?: string; error?: string }>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GOOGLE_LOGIN' }, (response) => {
        // Check for extension context invalidation
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '';
          if (errorMsg.includes('Extension context invalidated')) {
            reject(new Error('扩展已更新，请刷新页面后重试'));
          } else {
            reject(new Error(errorMsg || '无法连接到扩展'));
          }
          return;
        }
        resolve(response || {});
      });
    });

    if (oauthResult.error) {
      throw new Error(oauthResult.error);
    }

    if (!oauthResult.id_token) {
      throw new Error('获取 Google 授权失败');
    }

    // Send id_token to backend via background script (to avoid CORS)
    const result = await this.sendViaBackground(`${API_BASE_URL}/api/v1/google-oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id_token: oauthResult.id_token,
        invite_code: inviteCode || undefined,
      }),
    });

    if (result.status < 200 || result.status >= 300) {
      const errorData = result.data as { detail?: string } | null;
      console.error('[AuthService] Google login failed:', { status: result.status, data: result.data, error: result.error });
      throw new Error(errorData?.detail || `Login failed (HTTP ${result.status})`);
    }

    const data = result.data as LoginResponse;
    return this.processLoginResponse(data, data.user?.email || '');
  }

  /**
   * Send verification code to email
   * POST /api/v1/send-verification-code
   */
  async sendVerificationCode(email: string): Promise<boolean> {
    try {
      const result = await this.sendViaBackground(`${API_BASE_URL}/api/v1/send-verification-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      return result.status >= 200 && result.status < 300;
    } catch (error) {
      console.error('Error sending verification code:', error);
      return false;
    }
  }

  /**
   * Verify email code and login
   * POST /api/v1/email-login
   */
  async verifyCode(email: string, code: string, inviteCode?: string): Promise<User> {
    const result = await this.sendViaBackground(`${API_BASE_URL}/api/v1/email-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        code,
        invite_code: inviteCode || undefined,
      }),
    });

    if (result.status < 200 || result.status >= 300) {
      const errorData = result.data as { detail?: string } | null;
      throw new Error(errorData?.detail || 'Verification failed');
    }

    const data = result.data as LoginResponse;
    return this.processLoginResponse(data, email);
  }

  /**
   * Save user to chrome storage (only uses chrome.storage.local to avoid conflicts with web pages)
   */
  private async saveUser(user: User): Promise<void> {
    // Only use chrome.storage.local - do NOT use localStorage to avoid conflicts with bnbot.ai web pages
    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        await chrome.storage.local.set({ 'userData.bnbot': user });
        console.log('[AuthService] User saved to chrome.storage.local');
      } catch (error) {
        console.warn('[AuthService] Failed to save to chrome.storage:', error);
      }
    }
  }

  /**
   * Get saved user (only uses chrome.storage.local to avoid conflicts with web pages)
   */
  async getUser(): Promise<User | null> {
    // Only use chrome.storage.local - do NOT use localStorage to avoid conflicts with bnbot.ai web pages
    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        const user = await new Promise<User | null>((resolve) => {
          chrome.storage.local.get(['userData.bnbot'], (result) => {
            if (chrome.runtime.lastError) {
              console.warn('[AuthService] Chrome storage error:', chrome.runtime.lastError);
              resolve(null);
              return;
            }
            resolve((result['userData.bnbot'] as User | null) || null);
          });
        });
        return user;
      } catch (error) {
        console.warn('[AuthService] Failed to get from chrome.storage:', error);
      }
    }

    return null;
  }

  /**
   * Get access token from chrome.storage
   */
  async getAccessToken(): Promise<string | null> {
    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        const result = await chrome.storage.local.get([AuthService.ACCESS_TOKEN_KEY]);
        return (result[AuthService.ACCESS_TOKEN_KEY] as string | undefined) || null;
      } catch (error) {
        console.warn('[AuthService] Failed to get access token:', error);
      }
    }
    return null;
  }

  /**
   * Get refresh token from chrome.storage
   */
  async getRefreshToken(): Promise<string | null> {
    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        const result = await chrome.storage.local.get([AuthService.REFRESH_TOKEN_KEY]);
        return (result[AuthService.REFRESH_TOKEN_KEY] as string | undefined) || null;
      } catch (error) {
        console.warn('[AuthService] Failed to get refresh token:', error);
      }
    }
    return null;
  }

  /**
   * Refresh access token by calling /refresh endpoint
   * Uses Authorization header with refresh token
   * Handles concurrent refresh requests
   */
  async refreshAccessToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      console.log('[AuthService] Waiting for existing token refresh...');
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const refreshUrl = `${API_BASE_URL}/api/v1/refresh`;
      const refreshToken = await this.getRefreshToken();

      if (!refreshToken) {
        console.warn('[AuthService] No refresh token available');
        await this.logout();
        dispatchAuthEvent('session_expired', { reason: 'no_refresh_token' });
        return false;
      }

      try {
        console.log('[AuthService] Calling /refresh endpoint with refresh token');

        const result = await this.sendViaBackground(refreshUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${refreshToken}`,
          },
        });

        if (result.status < 200 || result.status >= 300) {
          console.warn('[AuthService] Refresh failed:', result.status);
          await this.logout();
          dispatchAuthEvent('session_expired', { reason: 'refresh_token_expired' });
          return false;
        }

        // Save new tokens from response
        const data = result.data as { access_token?: string; refresh_token?: string };
        if (data?.access_token && data?.refresh_token) {
          await this.saveTokens(data.access_token, data.refresh_token);
        } else if (data?.access_token) {
          // If only access token is returned, keep the old refresh token
          await this.saveTokens(data.access_token, refreshToken);
        }

        console.log('[AuthService] Token refreshed successfully');
        return true;
      } catch (error) {
        console.error('[AuthService] Error refreshing token:', error);
        await this.logout();
        dispatchAuthEvent('session_expired', { reason: 'refresh_error' });
        return false;
      } finally {
        // Clear the promise so future calls can start a new refresh
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Send API request via background script (avoids cross-origin cookie issues)
   */
  private async sendViaBackground(
    url: string,
    options: RequestInit = {}
  ): Promise<{ status: number; data: unknown; error?: string }> {
    return new Promise(async (resolve, reject) => {
      // Check extension context validity first
      if (!isExtensionContextValid()) {
        console.warn('[AuthService] Extension context invalidated, cannot send message');
        reject(new Error('Extension context invalidated. Please refresh the page.'));
        return;
      }

      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        reject(new Error('Chrome extension API not available'));
        return;
      }

      // Prepare message options
      const messageOptions: {
        method: string;
        headers?: Record<string, string>;
        body?: string;
        formData?: Array<{ key: string; value: string; filename?: string; type?: string; base64?: string }>;
      } = {
        method: options.method || 'GET',
        headers: options.headers as Record<string, string>,
      };

      // Handle FormData serialization
      if (options.body instanceof FormData) {
        const formDataEntries: Array<{ key: string; value: string; filename?: string; type?: string; base64?: string }> = [];

        for (const [key, value] of options.body.entries()) {
          if (value instanceof Blob) {
            // Convert Blob to base64 for transmission
            const arrayBuffer = await value.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            formDataEntries.push({
              key,
              value: '',
              filename: value instanceof File ? value.name : 'blob',
              type: value.type,
              base64,
            });
          } else {
            formDataEntries.push({ key, value: String(value) });
          }
        }

        messageOptions.formData = formDataEntries;
      } else if (options.body) {
        messageOptions.body = options.body as string;
      }

      chrome.runtime.sendMessage(
        {
          type: 'API_REQUEST',
          url,
          options: messageOptions,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || 'Unknown chrome runtime error';
            // Check for specific context invalidation error
            if (errorMsg.includes('Extension context invalidated') ||
              errorMsg.includes('message channel closed') ||
              errorMsg.includes('message port closed')) {
              console.warn('[AuthService] Extension context error:', errorMsg);
              reject(new Error('Extension context invalidated. Please refresh the page.'));
            } else {
              reject(new Error(errorMsg));
            }
            return;
          }
          // Handle case where response is undefined (channel closed before response)
          if (response === undefined) {
            console.warn('[AuthService] No response received from background script');
            resolve({ status: 0, data: null, error: 'No response from background script' });
            return;
          }
          resolve(response);
        }
      );
    });
  }

  /**
   * Fetch with automatic token refresh on 401 errors
   * Uses background script with Authorization header
   */
  async fetchWithAuth(url: string, options: RequestInit = {}, _isRetry = false): Promise<Response> {
    // Check if extension context is still valid
    const contextValid = isExtensionContextValid();
    if (!contextValid) {
      console.warn('[AuthService] Extension context invalidated, skipping request to:', url);
      return {
        ok: false,
        status: 0,
        json: async () => ({ error: 'Extension context invalidated' }),
        text: async () => 'Extension context invalidated',
      } as Response;
    }

    console.log('[AuthService] fetchWithAuth called for:', url);

    // Get access token for Authorization header
    const accessToken = await this.getAccessToken();
    const headers = {
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Try via background script first
    let result = await this.sendViaBackground(url, { ...options, headers });
    console.log('[AuthService] Response status:', result.status);

    // If 401 and not already retrying, attempt token refresh and retry once
    if (result.status === 401 && !_isRetry) {
      console.log('[AuthService] Got 401 - attempting token refresh...');
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        console.log('[AuthService] Token refreshed, retrying request...');
        return this.fetchWithAuth(url, options, true);
      }
      console.log('[AuthService] Token refresh failed - user needs to login');
    }

    // Convert to Response-like object
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.data,
      text: async () => JSON.stringify(result.data),
    } as Response;
  }

  /**
   * Fetch with automatic token refresh on 401 errors, using background script for streaming.
   * Uses Authorization header for authentication.
   */
  async fetchStreamWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
      console.warn('[AuthService] Extension context invalidated, skipping stream request');
      return {
        ok: false,
        status: 0,
        body: null,
        json: async () => ({ error: 'Extension context invalidated' }),
        text: async () => 'Extension context invalidated',
      } as Response;
    }

    console.log('[AuthService] fetchStreamWithAuth called for:', url);

    // Get access token for Authorization header
    const accessToken = await this.getAccessToken();
    const headers = {
      ...(options.headers as Record<string, string>),
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Use background script port for streaming
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
        reject(new Error('Chrome extension API not available'));
        return;
      }

      const port = chrome.runtime.connect({ name: 'STREAM_API' });
      let statusReceived = false;
      let responseStatus = 0;
      let responseOk = false;
      let streamEnded = false;
      let errorOccurred = false;
      let errorMessage = '';
      let errorStatus = 0;

      // Create a ReadableStream to provide chunk data
      const stream = new ReadableStream({
        start(controller) {
          port.onMessage.addListener((msg: any) => {
            if (msg.type === 'STREAM_STATUS') {
              statusReceived = true;
              responseStatus = msg.status;
              responseOk = msg.ok;
            } else if (msg.type === 'STREAM_CHUNK') {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(msg.chunk));
            } else if (msg.type === 'STREAM_END') {
              streamEnded = true;
              controller.close();
            } else if (msg.type === 'STREAM_ERROR') {
              errorOccurred = true;
              errorMessage = msg.error;
              errorStatus = msg.status;
              controller.close();
            }
          });

          port.onDisconnect.addListener(() => {
            if (!streamEnded && !errorOccurred) {
              controller.close();
            }
          });
        },
        cancel() {
          port.disconnect();
        }
      });

      // Wait for initial status before returning the Response
      const checkStatus = () => {
        if (statusReceived) {
          // Handle 401 by refreshing token - CHECK THIS FIRST
          // The background script sends both STREAM_STATUS(401) and STREAM_ERROR(401)
          // We must catch this before the generic error handler rejects the promise
          if (responseStatus === 401 || errorStatus === 401) {
            port.disconnect();
            console.log('[AuthService] Got 401 on stream - attempting token refresh...');
            this.refreshAccessToken().then(refreshed => {
              if (refreshed) {
                console.log('[AuthService] Token refreshed, retrying stream...');
                // Retry with a new port
                this.fetchStreamWithAuth(url, options).then(resolve).catch(reject);
              } else {
                console.log('[AuthService] Token refresh failed for stream');
                reject(new Error('Authentication failed'));
              }
            });
            return;
          }

          if (errorOccurred) {
            // Create an error response
            const error = new Error(errorMessage);
            (error as any).status = errorStatus;
            reject(error);
            return;
          }

          // Create a Response-like object with the stream
          const response = new Response(stream, {
            status: responseStatus,
            statusText: responseOk ? 'OK' : 'Error',
          });

          resolve(response);
          // 401 check was previously here, unreachable if errorOccurred was true
        } else if (errorOccurred) {
          // If error happened before status (shouldn't happen with current bg script but safety net)
          if (errorStatus === 401) {
            // Handle 401 if it came via error only
            port.disconnect();
            this.refreshAccessToken().then(refreshed => {
              if (refreshed) {
                this.fetchStreamWithAuth(url, options).then(resolve).catch(reject);
              } else {
                reject(new Error('Authentication failed'));
              }
            });
            return;
          }
          const error = new Error(errorMessage);
          (error as any).status = errorStatus;
          reject(error);
        } else {
          setTimeout(checkStatus, 10);
        }
      };



      // Start the stream request with Authorization header
      port.postMessage({
        type: 'START_STREAM',
        url,
        options: {
          method: options.method || 'POST',
          headers,
          body: options.body as string,
        },
      });

      // Start checking for status
      checkStatus();
    });
  }

  /**
   * Fetch user credits from API
   * GET /api/v1/payments/credits
   */
  async fetchCredits(): Promise<number> {
    try {
      console.log('[AuthService] fetchCredits - Making API request');
      const response = await this.fetchWithAuth(`${API_BASE_URL}/api/v1/payments/credits`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.error('Failed to fetch credits:', response.status);
        return 0;
      }

      const data = await response.json();
      const credits = data.credits ?? data.balance ?? 0;
      const x_balance = data.x_balance ?? 0;
      console.log('[AuthService] fetchCredits - Received credits:', credits, 'x_balance:', x_balance);

      // Update stored user with new credits
      const user = await this.getUser();
      if (user) {
        user.credits = credits;
        user.x_balance = x_balance;
        await this.saveUser(user);
      }

      return credits;
    } catch (error) {
      console.error('Error fetching credits:', error);
      return 0;
    }
  }

  /**
   * Fetch user subscription from API
   * GET /api/v1/stripe/subscription
   */
  async fetchSubscription(): Promise<SubscriptionResponse> {
    try {
      console.log('[AuthService] fetchSubscription - Making API request');
      const response = await this.fetchWithAuth(`${API_BASE_URL}/api/v1/payments/stripe/subscription`, {
        method: 'GET',
      });

      if (!response.ok) {
        // 404 means no subscription - this is normal, not an error
        if (response.status !== 404) {
          console.error('Failed to fetch subscription:', response.status);
        }
        return { has_subscription: false };
      }

      const data: SubscriptionResponse = await response.json();
      console.log('[AuthService] fetchSubscription - Received subscription data:', data.has_subscription);

      // Update stored user with subscription tier
      if (data.has_subscription && data.subscription) {
        const user = await this.getUser();
        if (user) {
          user.subscription_tier = data.subscription.plan_name;
          await this.saveUser(user);
        }
      }

      return data;
    } catch (error) {
      console.error('Error fetching subscription:', error);
      return { has_subscription: false };
    }
  }

  /**
   * Generate auth code and open website with automatic login
   * @param path - optional path to navigate to (e.g. '/pricing')
   */
  async openWebsiteWithAuth(path: string = ''): Promise<void> {
    const baseUrl = 'https://bnbot.ai';
    const targetUrl = `${baseUrl}${path}`;

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      window.open(targetUrl, '_blank');
      return;
    }

    try {
      const response = await this.fetchWithAuth(
        `${API_BASE_URL}/api/v1/auth/create-auth-token`,
        { method: 'POST' }
      );

      if (response.ok) {
        const data = await response.json() as { code: string };
        window.open(`${targetUrl}?auth_code=${data.code}`, '_blank');
      } else {
        console.warn('[AuthService] Failed to create auth token, opening website without auth');
        window.open(targetUrl, '_blank');
      }
    } catch (error) {
      console.error('[AuthService] Failed to generate auth code:', error);
      window.open(targetUrl, '_blank');
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    console.log('[AuthService] Logging out, clearing tokens');

    // Only clear chrome.storage.local - do NOT use localStorage to avoid conflicts with bnbot.ai web pages
    if (typeof chrome !== 'undefined' && chrome.storage && isExtensionContextValid()) {
      try {
        await chrome.storage.local.remove([
          'userData.bnbot',
          AuthService.ACCESS_TOKEN_KEY,
          AuthService.REFRESH_TOKEN_KEY,
        ]);
        console.log('[AuthService] Tokens and user data cleared from storage');
      } catch (error) {
        console.warn('[AuthService] Failed to remove from chrome.storage:', error);
      }
    }

    // Tokens are stored in httpOnly cookies by backend
    // They will be cleared automatically when user logs out from the backend
    // or when their session expires

    // Clear Google identity cache so user gets prompted to choose email on next login
    // (clearAllCachedAuthTokens may not be available on all browsers, e.g. Firefox)
    if (typeof chrome !== 'undefined' && chrome.identity?.clearAllCachedAuthTokens && isExtensionContextValid()) {
      try {
        await new Promise<void>((resolve) => {
          chrome.identity.clearAllCachedAuthTokens(() => {
            if (chrome.runtime.lastError) {
              console.warn('[AuthService] Failed to clear Google identity cache:', chrome.runtime.lastError.message);
            } else {
              console.log('[AuthService] Google identity cache cleared');
            }
            resolve();
          });
        });
      } catch (error) {
        console.warn('[AuthService] Error clearing Google identity cache:', error);
      }
    }
  }
}

export const authService = new AuthService();
