// OAuth callback page script
// Extracts id_token from URL and sends to background script

const hash = window.location.hash.substring(1);
const params = new URLSearchParams(hash);
const idToken = params.get('id_token');
const error = params.get('error');

if (error) {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = `登录失败: ${error}`;
    errorEl.style.display = 'block';
  }
  // Close window after 2 seconds
  setTimeout(() => window.close(), 2000);
} else if (idToken) {
  // Send id_token to background script
  chrome.runtime.sendMessage({ type: 'OAUTH_CALLBACK', id_token: idToken }, () => {
    window.close();
  });
} else {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = '未收到授权信息';
    errorEl.style.display = 'block';
  }
  setTimeout(() => window.close(), 2000);
}
