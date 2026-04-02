'use client'

import { useEffect } from 'react'
import { useAuth } from './useAuth'

// Access token 过期时间：2 小时
const ACCESS_TOKEN_EXPIRE_MS = 2 * 60 * 60 * 1000

/**
 * 自动在 token 过期前 5 分钟刷新 token
 * 使用方法：
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <AutoRefreshProvider>
 *           {children}
 *         </AutoRefreshProvider>
 *       </body>
 *     </html>
 *   )
 * }
 */
export function useAutoRefresh() {
  const { refreshToken } = useAuth()

  useEffect(() => {
    // 设置定时器，在 token 过期前 5 分钟自动刷新
    const timer = setTimeout(() => {
      refreshToken().catch(() => {
        // 刷新失败，用户需要重新登录
        console.warn('Token refresh failed, user may need to re-authenticate')
      })
    }, ACCESS_TOKEN_EXPIRE_MS - 5 * 60 * 1000)

    return () => clearTimeout(timer)
  }, [refreshToken])
}
