/**
 * Telegram Integration Service
 * Handles Telegram binding and notification settings
 */

import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

export interface TelegramStatus {
  linked: boolean;
  chat_id: string | null;
  username: string | null;
  linked_at: string | null;
  report_enabled: boolean;
  report_interval_hours: number;
  extension_online: boolean;
  bot_configured: boolean;
}

export interface BindingLinkResponse {
  deep_link: string;
  bot_username: string;
}

class TelegramService {
  /**
   * Get current Telegram link status
   */
  async getStatus(): Promise<TelegramStatus | null> {
    try {
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/telegram/status`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('[TelegramService] Failed to get status:', error);
      return null;
    }
  }

  /**
   * Get deep link for binding Telegram
   */
  async getBindingLink(): Promise<BindingLinkResponse | null> {
    try {
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/telegram/binding-link`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('[TelegramService] Failed to get binding link:', error);
      return null;
    }
  }

  /**
   * Unlink Telegram account
   */
  async unlink(): Promise<boolean> {
    try {
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/telegram/link`, {
        method: 'DELETE'
      });
      return response.ok;
    } catch (error) {
      console.error('[TelegramService] Failed to unlink:', error);
      return false;
    }
  }

  /**
   * Update report settings
   */
  async updateSettings(enabled: boolean, intervalHours: number): Promise<boolean> {
    try {
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/telegram/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          interval_hours: intervalHours
        })
      });
      return response.ok;
    } catch (error) {
      console.error('[TelegramService] Failed to update settings:', error);
      return false;
    }
  }

  /**
   * Open Telegram deep link in new tab
   */
  openBindingLink(deepLink: string): void {
    window.open(deepLink, '_blank');
  }
}

export const telegramService = new TelegramService();
