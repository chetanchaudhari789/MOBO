import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
} from 'react';
import { AppNotification } from '../types';

interface NotificationContextType {
  notifications: AppNotification[];
  showNotification: (notification: Omit<AppNotification, 'id'>) => void;
  removeNotification: (id: string) => void;
}

const STORAGE_KEY = 'mobo_v7_notifications';

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Load from storage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setNotifications(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load notifications', e);
      }
    }
  }, []);

  // Save to storage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const showNotification = useCallback((notification: Omit<AppNotification, 'id'>) => {
    const id = Date.now().toString();
    const newNotification = { ...notification, id };

    // History/Inbox style
    setNotifications((prev) => [newNotification, ...prev].slice(0, 30));
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, showNotification, removeNotification }}>
      {children}
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
