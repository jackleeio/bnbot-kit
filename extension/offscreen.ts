/**
 * Offscreen Document WebSocket Manager (Chrome only)
 * Maintains a persistent WebSocket connection that survives Service Worker termination
 * Uses shared WebSocketManager for core WS logic.
 */

import { WebSocketManager } from './utils/websocketManager';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const WS_BASE_URL = process.env.WS_BASE_URL || '';

function requestFreshToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'REQUEST_FRESH_TOKEN' }, (response) => {
      if (chrome.runtime.lastError || !response?.accessToken) {
        resolve(null);
      } else {
        resolve(response.accessToken);
      }
    });
  });
}

const wsManager = new WebSocketManager(API_BASE_URL, {
  notifyHost(data) {
    chrome.runtime.sendMessage(data).catch(() => {
      // Background might not be listening, ignore
    });
  },
  requestFreshToken,
}, WS_BASE_URL || undefined);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_WS_CONNECT') {
    wsManager.connect(message.userId, message.accessToken)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OFFSCREEN_WS_DISCONNECT') {
    wsManager.disconnect();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'OFFSCREEN_WS_SEND') {
    const success = wsManager.send(message.message);
    sendResponse({ success });
    return true;
  }

  if (message.type === 'OFFSCREEN_WS_STATUS') {
    sendResponse(wsManager.getStatus());
    return true;
  }

  // Token refresh from background
  if (message.type === 'OFFSCREEN_WS_UPDATE_TOKEN') {
    wsManager.updateToken(message.accessToken);
    sendResponse({ success: true });
    return true;
  }
});

console.log('[OffscreenWS] Offscreen document loaded');
