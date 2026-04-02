'use client'

import { useEffect, useRef } from 'react'
import { apiClient } from '@/lib/api-client'

/**
 * Global component that detects auth_code in URL params and exchanges it for a login session.
 * Used when users click "Upgrade Plan" from the Chrome extension — they arrive at bnbot.ai
 * with an auth_code that gets exchanged for httpOnly cookies, so they're auto-logged in.
 *
 * Place this in the root layout so it works on every page.
 */
export function AuthCodeExchange() {
  const exchanged = useRef(false)

  useEffect(() => {
    if (exchanged.current) return
    const params = new URLSearchParams(window.location.search)
    const authCode = params.get('auth_code')
    if (!authCode) return

    exchanged.current = true

    apiClient
      .post('/api/v1/auth/exchange-code', { code: authCode })
      .then(() => {
        // Clean up URL
        const url = new URL(window.location.href)
        url.searchParams.delete('auth_code')
        window.history.replaceState({}, '', url.pathname + url.search)
        // Reload to pick up the new session cookies
        window.location.reload()
      })
      .catch((error) => {
        console.error('[AuthCodeExchange] Failed:', error)
        // Clean up URL even on failure
        const url = new URL(window.location.href)
        url.searchParams.delete('auth_code')
        window.history.replaceState({}, '', url.pathname + url.search)
      })
  }, [])

  return null
}
