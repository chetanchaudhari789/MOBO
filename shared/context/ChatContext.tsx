import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

const MAX_PERSISTED_MESSAGES = 200;
const STORAGE_KEY_PREFIX = 'mobo_v7_chat_messages';

interface ChatContextType {
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clearChat: () => void;
  /** Bind to a specific user so messages are isolated per account. */
  setUserId: (userId: string | null) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

function getStorageKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_PREFIX}:${userId}` : `${STORAGE_KEY_PREFIX}:anon`;
}

function loadMessages(userId: string | null): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_PERSISTED_MESSAGES) : [];
  } catch {
    return [];
  }
}

function persistMessages(userId: string | null, messages: ChatMessage[]): void {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
    sessionStorage.setItem(getStorageKey(userId), JSON.stringify(trimmed));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const initialized = useRef(false);
  const prevUserId = useRef<string | null>(null);

  // Load persisted messages when userId changes
  useEffect(() => {
    const loaded = loadMessages(userId);
    setMessages(loaded);
    initialized.current = true;
    prevUserId.current = userId;
  }, [userId]);

  // Persist messages whenever they change (debounced via effect)
  useEffect(() => {
    if (!initialized.current) return;
    // Skip persistence if userId just changed to prevent persisting old user's messages to new user's key
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      return;
    }
    persistMessages(userId, messages);
  }, [messages, userId]);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev, message];
      // Cap in-memory messages to prevent memory pressure
      return next.length > MAX_PERSISTED_MESSAGES ? next.slice(-MAX_PERSISTED_MESSAGES) : next;
    });
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    try {
      sessionStorage.removeItem(getStorageKey(userId));
    } catch {
      // ignore
    }
  }, [userId]);

  return (
    <ChatContext.Provider value={{ messages, addMessage, setMessages, clearChat, setUserId }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
