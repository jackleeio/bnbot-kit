'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { clearAuthCookies } from '@/lib/cookie-utils'

export interface User {
  id: string
  email: string
  username?: string
  full_name?: string
  avatar?: string
  [key: string]: any
}

export interface AuthContextType {
  user: User | null
  isLoading: boolean
  isLoggedIn: boolean
  login: (email: string, code: string, inviteCode?: string | null) => Promise<any>
  googleLogin: (idToken: string, inviteCode?: string | null) => Promise<any>
  logout: () => Promise<void>
  refreshToken: () => Promise<any>
  checkAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export { AuthContext }

export function useAuthProvider(): AuthContextType {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const checkAuthInProgress = useRef(false)

  const checkAuth = useCallback(async () => {
    // 防止并发检查
    if (checkAuthInProgress.current) return
    checkAuthInProgress.current = true

    try {
      setIsLoading(true)
      // 先尝试 POST，如果失败再尝试 GET
      let response
      try {
        response = await apiClient.post<User>('/api/v1/login/test-token', {})
      } catch (postError) {
        response = await apiClient.get<User>('/api/v1/login/test-token')
      }
      setUser(response)
    } catch (error) {
      console.error('Auth check failed:', error)
      setUser(null)
      // 清除可能过期的 cookies
      clearAuthCookies()
    } finally {
      setIsLoading(false)
      checkAuthInProgress.current = false
    }
  }, [])

  // 初始化时检查用户是否已登录
  useEffect(() => {
    checkAuth()
  }, [])

  const login = useCallback(
    async (email: string, code: string, inviteCode?: string | null) => {
      try {
        const response = await apiClient.post<{ user: User; access_token?: string }>(
          '/api/v1/email-login',
          {
            email,
            code,
            ...(inviteCode && { invite_code: inviteCode }),
          }
        )
        // 后端自动通过 httpOnly Cookie 设置 token
        // 前端只需保存 user 数据
        setUser(response.user)
        return response
      } catch (error) {
        setUser(null)
        throw error
      }
    },
    []
  )

  const googleLogin = useCallback(
    async (idToken: string, inviteCode?: string | null) => {
      try {
        const response = await apiClient.post<{ user: User; access_token?: string }>(
          '/api/v1/google-oauth',
          {
            id_token: idToken,
            ...(inviteCode && { invite_code: inviteCode }),
          }
        )
        setUser(response.user)
        return response
      } catch (error) {
        setUser(null)
        throw error
      }
    },
    []
  )

  const logout = useCallback(async () => {
    try {
      setUser(null)
      clearAuthCookies()
    } catch (error) {
      console.error('Logout error:', error)
      setUser(null)
      clearAuthCookies()
    }
  }, [])

  const refreshToken = useCallback(async () => {
    try {
      const response = await apiClient.post<{ user: User }>(
        '/api/v1/refresh',
        {}
      )
      setUser(response.user)
      return response
    } catch (error) {
      setUser(null)
      throw error
    }
  }, [])

  return {
    user,
    isLoading,
    isLoggedIn: !!user,
    login,
    googleLogin,
    logout,
    refreshToken,
    checkAuth,
  }
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
