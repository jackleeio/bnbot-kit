import { useState, useEffect } from 'react';
import { xUserStore, XUserInfo } from '../stores/xUserStore';

/**
 * React Hook 获取当前 X 用户信息
 * 自动订阅用户信息变化
 */
export function useXUser(): XUserInfo {
  const [userInfo, setUserInfo] = useState<XUserInfo>(xUserStore.getUserInfo());

  useEffect(() => {
    const unsubscribe = xUserStore.subscribe(setUserInfo);
    return unsubscribe;
  }, []);

  return userInfo;
}

/**
 * React Hook 获取当前 X 用户名 (便捷方法)
 */
export function useXUsername(): string | null {
  const { username } = useXUser();
  return username;
}
