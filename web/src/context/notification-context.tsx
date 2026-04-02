'use client'
// NotificationContext.tsx
import React, { createContext, useState, useContext, useCallback } from 'react';
import SimpleNotify from '@/components/notification/simple-notify';  // 假设这是您现有的 SimpleNotify 组件

type NotificationType = 'success' | 'error' | 'warning';

interface NotificationContextType {
  showNotification: (notification: {
    msg: string;
    type: NotificationType;
    title: string;
    icon?: React.ReactNode;  // 添加 icon 属性
  }) => void;
  hideNotification: () => void;
}

interface NotificationProviderProps {
  children: React.ReactNode;
}

interface NotificationState {
  show: boolean;
  msg: string;
  type: NotificationType;
  title: string;
  icon?: React.ReactNode;  // 添加 icon 属性
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    title: '',
    msg: '',
    type: 'success',
  });

  const showNotification = useCallback((newNotification: {
    msg: string;
    type: NotificationType;
    title: string;
    icon?: React.ReactNode;  // 添加 icon 属性
  }) => {
    setNotification({ ...newNotification, show: true });
  }, []);

  const hideNotification = useCallback(() => {
    setNotification(prev => ({ ...prev, show: false }));
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification, hideNotification }}>
      {children}
      <SimpleNotify notification={notification} setShow={hideNotification} />
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
