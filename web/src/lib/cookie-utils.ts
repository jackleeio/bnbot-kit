/**
 * Cookie utilities for token management
 * In production, tokens should be stored in httpOnly cookies by the backend
 * This utility provides client-side access when needed
 */

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null

  const nameEQ = encodeURIComponent(name) + '='
  const cookies = document.cookie.split(';')

  for (let cookie of cookies) {
    cookie = cookie.trim()
    if (cookie.startsWith(nameEQ)) {
      return decodeURIComponent(cookie.substring(nameEQ.length))
    }
  }

  return null
}

export function getAccessToken(): string | null {
  // Try common token cookie names
  return getCookie('access_token') || getCookie('accessToken') || getCookie('auth_token')
}

export function getRefreshToken(): string | null {
  return getCookie('refresh_token') || getCookie('refreshToken')
}

export function removeCookie(name: string): void {
  if (typeof document === 'undefined') return

  document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
}

export function clearAuthCookies(): void {
  removeCookie('access_token')
  removeCookie('refresh_token')
  removeCookie('accessToken')
  removeCookie('refreshToken')
  removeCookie('auth_token')
}
