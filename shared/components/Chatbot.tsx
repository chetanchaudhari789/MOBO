import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ArrowRight,
  Mic,
  MicOff,
  Paperclip,
  CalendarClock,
  CheckCircle2,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useNotification } from '../context/NotificationContext';
import { api, compressImage } from '../services/api';
import { Ticket } from '../types';
import { ProductCard } from './ProductCard';

interface ChatbotProps {
  isVisible?: boolean;
  onNavigate?: (tab: 'home' | 'explore' | 'orders' | 'profile') => void;
}

const MoboAvatar: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const isSmall = size === 'sm';
  const sizeClasses = isSmall ? 'w-8 h-8' : 'w-11 h-11';
  const eyeSize = isSmall ? 'w-[3px] h-[4px]' : 'w-[4px] h-[6px]';
  const smileSize = isSmall ? 'w-2.5 h-1' : 'w-3.5 h-1.5';

  return (
    <div
      className={`${sizeClasses} bg-gradient-to-b from-amber-300 to-yellow-500 rounded-full shadow-[inset_-2px_-2px_6px_rgba(0,0,0,0.1),0_4px_10px_rgba(245,158,11,0.3)] flex items-center justify-center relative overflow-hidden ${!isSmall ? 'animate-[bounce_3s_infinite] motion-reduce:animate-none' : ''}`}
    >
      <div className="absolute top-1 left-2 w-1/3 h-1/4 bg-white/40 blur-[1px] rounded-full -rotate-12"></div>
      <div
        className={`relative z-10 flex flex-col items-center ${isSmall ? 'top-[1px]' : 'top-[2px]'}`}
      >
        <div className="flex gap-[5px] mb-[1px]">
          <div className={`${eyeSize} bg-zinc-900 rounded-full`}></div>
          <div className={`${eyeSize} bg-zinc-900 rounded-full`}></div>
        </div>
        <div className={`${smileSize} border-b-[1.5px] border-zinc-900 rounded-full`}></div>
      </div>
    </div>
  );
};

const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-extrabold text-slate-900">
            {part}
          </strong>
        ) : (
          part
        )
      )}
    </span>
  );
};

export const Chatbot: React.FC<ChatbotProps> = ({ isVisible = true, onNavigate }) => {
  const { messages, addMessage } = useChat();
  const { notifications, removeNotification, unreadCount, markAllRead } = useNotification();
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const [attachment, setAttachment] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const placeholders = [
    'Find me loot deals...',
    'Check my latest order',
    'Where is my cashback?',
    'Navigate to my profile',
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const makeMessageId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID() as string;
      }
    } catch {
      // ignore
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  useEffect(() => {
    // Keep placeholder suggestions helpful, but avoid distraction while typing/focused.
    if (isInputFocused || inputText.trim().length > 0) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [isInputFocused, inputText, placeholders.length]);

  useEffect(() => {
    if (!isVisible) return;
    // Preserve expected chat behavior: auto-scroll only when already near the bottom.
    if (!isAtBottom) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, [messages.length, isTyping, isVisible, isAtBottom]);

  useEffect(() => {
    if (!isVisible) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, [isVisible]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    ) {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toLowerCase();

        // [AI] Voice Command Expansion (Legacy Fallback)
        if (
          transcript.includes('order') ||
          transcript.includes('purchase') ||
          transcript.includes('status')
        ) {
          onNavigate?.('orders');
          addMessage({
            id: makeMessageId(),
            role: 'model',
            text: 'Opening your **Orders** tab.',
            timestamp: Date.now(),
          });
        } else if (
          transcript.includes('deal') ||
          transcript.includes('loot') ||
          transcript.includes('explore')
        ) {
          onNavigate?.('explore');
          addMessage({
            id: makeMessageId(),
            role: 'model',
            text: "Sure — let's explore some **Loot Deals**.",
            timestamp: Date.now(),
          });
        } else if (
          transcript.includes('profile') ||
          transcript.includes('account') ||
          transcript.includes('wallet')
        ) {
          onNavigate?.('profile');
          addMessage({
            id: makeMessageId(),
            role: 'model',
            text: 'Navigating to your **Profile & Wallet**.',
            timestamp: Date.now(),
          });
        } else {
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, [onNavigate, addMessage]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error('Mic Error', e);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAttachment(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const clearAttachment = () => {
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendMessage = async (e?: React.FormEvent, overrideText?: string) => {
    e?.preventDefault();
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() && !attachment) return;

    let base64Image: string | undefined = undefined;
    if (attachment) {
      const rawBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(attachment);
      });
      // [Security] Image Compression
      base64Image = await compressImage(rawBase64);
    }

    addMessage({
      id: makeMessageId(),
      role: 'user',
      text: textToSend,
      image: base64Image,
      timestamp: Date.now(),
    });

    setInputText('');
    clearAttachment();
    setIsTyping(true);

    try {
      const [allProducts, userOrders, allTickets] = await Promise.all([
        api.products.getAll(user?.mediatorCode),
        api.orders.getUserOrders(user?.id || ''),
        api.tickets.getAll(),
      ]);
      const userTickets = allTickets.filter((t: Ticket) => t.userId === user?.id);

      const response = await api.chat.sendMessage(
        textToSend,
        user?.id || 'guest',
        user?.name || 'Guest',
        allProducts,
        userOrders,
        userTickets,
        base64Image
      );

      // Recommendation 1: Dynamic Navigation Handling
      if (response.navigateTo) {
        setTimeout(() => {
          onNavigate?.(response.navigateTo as any);
        }, 1500);
      }

      addMessage({
        id: makeMessageId(),
        role: 'model',
        text: response.text,
        timestamp: Date.now(),
        relatedProducts: response.uiType === 'product_card' ? response.data : undefined,
        relatedOrders: response.uiType === 'order_card' ? response.data : undefined,
      });
    } catch {
      addMessage({
        id: makeMessageId(),
        role: 'model',
        text: 'Something went wrong. Please try again.',
        isError: true,
        timestamp: Date.now(),
      });
    } finally {
      setIsTyping(false);
    }
  };

  const quickActions = [
    { emoji: '🔥', text: 'Loot Deals', command: 'Show me the top 5 loot deals' },
    { emoji: '📦', text: 'Latest Order', command: 'Where is my latest order?' },
    { emoji: '🎟️', text: 'Tickets', command: 'Check status of my support tickets' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-[#F4F4F5]">
      {/* Header */}
      <div className="shrink-0 w-full bg-white border-b border-gray-100 shadow-sm px-5 py-4 safe-top flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <MoboAvatar size="md" />
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-[3px] border-white rounded-full z-20"></div>
          </div>
          <h1 className="font-extrabold text-lg text-slate-900 leading-none tracking-tight">
            Mobo
          </h1>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={showNotifications ? 'Hide notifications' : 'Show notifications'}
            className="w-10 h-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 relative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white animate-pulse motion-reduce:animate-none"></span>
            )}
          </button>
        </div>
      </div>

      {showNotifications && (
        <div className="shrink-0 px-5 pt-2">
          <div className="flex justify-end">
            <div className="w-[78vw] max-w-[340px] bg-white rounded-[2rem] shadow-2xl border border-gray-100 p-2 animate-enter">
              <div className="px-4 py-3 flex justify-between items-center border-b border-gray-50 mb-1">
                <h3 className="font-extrabold text-sm text-slate-900">Notifications</h3>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full">
                  {unreadCount > 0 ? `${unreadCount} new` : `${notifications.length}`}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 pb-2">
                <button
                  onClick={() => markAllRead()}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-900"
                >
                  Mark all read
                </button>
                <button
                  onClick={() => setShowNotifications(false)}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[360px] overflow-y-auto scrollbar-hide space-y-2 p-1">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Bell size={20} className="text-slate-300 mb-2" />
                    <p className="text-xs font-bold text-slate-400">All caught up!</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className="bg-slate-50 p-3 rounded-[1.2rem] relative group border border-slate-100"
                    >
                      <div className="flex gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                            n.type === 'alert'
                              ? 'bg-red-100 text-red-600'
                              : n.type === 'success'
                                ? 'bg-green-100 text-green-600'
                                : 'bg-blue-100 text-blue-600'
                          }`}
                        >
                          {n.type === 'alert' ? (
                            <AlertTriangle size={18} />
                          ) : n.type === 'success' ? (
                            <CheckCircle2 size={18} />
                          ) : (
                            <Bell size={18} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-xs font-bold text-slate-900 mb-0.5 leading-tight">
                            {n.title}
                          </p>
                          <div className="text-[10px] font-medium text-slate-500 leading-snug">
                            {n.message}
                          </div>
                          {n.createdAt && (
                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-1">
                              {new Date(n.createdAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                      {n.action && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            n.action?.onClick();
                            removeNotification(n.id);
                            setShowNotifications(false);
                          }}
                          className="mt-3 w-full py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700"
                        >
                          {n.action.label}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(n.id);
                        }}
                        className="absolute -top-1 -right-1 bg-white border border-gray-100 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={() => {
          const el = scrollContainerRef.current;
          if (!el) return;
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setIsAtBottom(distanceFromBottom < 80);
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-6 scrollbar-hide"
      >
        <div className="flex flex-col gap-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-[520px] w-full">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <MoboAvatar size="md" />
                </div>
                <div className="bg-white border border-slate-100 rounded-[1.5rem] rounded-tl-sm px-5 py-4 shadow-sm">
                  <div className="text-sm font-semibold text-slate-900 leading-relaxed">
                    Ask me about **deals**, **orders**, or **tickets**.
                  </div>
                  <div className="mt-1 text-xs text-slate-500 leading-relaxed">
                    Use the quick actions below to get started.
                  </div>
                </div>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-enter`}
            >
              <div
                className={`flex max-w-[90%] md:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} gap-3 items-end`}
              >
              {msg.role === 'model' && (
                <div className="flex-shrink-0 mb-1">
                  <MoboAvatar size="sm" />
                </div>
              )}
                <div
                  className={`flex flex-col gap-2 min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                {msg.image && (
                  <div className="rounded-2xl overflow-hidden border-4 border-white shadow-md max-w-[200px]">
                    <img src={msg.image} className="w-full h-auto bg-gray-100" alt="Attachment" />
                  </div>
                )}
                {msg.text && (
                  <div
                    className={`px-5 py-3 text-[15px] leading-relaxed shadow-sm relative break-words whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-black text-white rounded-[1.5rem] rounded-tr-sm'
                        : 'bg-white text-slate-800 rounded-[1.5rem] rounded-tl-sm border border-slate-100 font-medium'
                    } ${msg.isError ? 'bg-red-50 border-red-100 text-red-600' : ''}`}
                  >
                    <FormattedText text={msg.text} />
                  </div>
                )}
                </div>
              </div>
            {msg.relatedProducts && msg.relatedProducts.length > 0 && (
              <div className="w-screen relative left-1/2 -translate-x-1/2 mt-4 pl-4 overflow-x-auto scrollbar-hide snap-x">
                <div className="flex gap-4 w-max pr-8 pl-4 pb-4">
                  {msg.relatedProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            )}
            {msg.relatedOrders && msg.relatedOrders.length > 0 && (
              <div className="ml-11 mt-3 space-y-3 w-full max-w-[320px]">
                {msg.relatedOrders.map((order) => {
                  const isPaid = order.paymentStatus === 'Paid';
                  const isVerified = order.affiliateStatus === 'Pending_Cooling';
                  return (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative overflow-hidden active:scale-95 transition-transform"
                    >
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1.5 ${isPaid ? 'bg-green-500' : isVerified ? 'bg-blue-500' : 'bg-orange-500'}`}
                      ></div>
                      <div className="flex gap-4">
                        <div className="w-14 h-14 bg-slate-50 rounded-xl p-1.5 border border-slate-100 flex-shrink-0">
                          <img
                            src={order.items[0].image}
                            className="w-full h-full object-contain mix-blend-multiply"
                            alt=""
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 truncate mb-1">
                            {order.items[0].title}
                          </p>
                          <div className="flex justify-between items-end">
                            <div className="flex flex-col">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded w-fit uppercase ${isPaid ? 'bg-green-100 text-green-700' : isVerified ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}
                              >
                                {isPaid ? 'Settled' : isVerified ? 'Verified' : order.status}
                              </span>
                              {order.expectedSettlementDate && !isPaid && (
                                <span className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                  <CalendarClock size={10} />{' '}
                                  {new Date(order.expectedSettlementDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-mono font-bold text-slate-900">
                              ₹{order.total}
                            </span>
                          </div>
                        </div>
                      </div>
                      {isPaid && (
                        <div className="absolute top-2 right-2 text-green-500">
                          <CheckCircle2 size={16} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          ))}
          {isTyping && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Mobo is typing"
              className="ml-11 flex gap-1.5 p-3 items-center bg-white w-fit rounded-2xl rounded-tl-sm border border-slate-100 shadow-sm"
            >
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce motion-reduce:animate-none"></span>
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.1s] motion-reduce:animate-none"></span>
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s] motion-reduce:animate-none"></span>
            </div>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      <div className="shrink-0 w-full px-4 pb-28 safe-bottom">
        <div className="flex gap-2.5 overflow-x-auto pb-4 scrollbar-hide justify-center">
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(undefined, action.command)}
              className="flex-shrink-0 px-4 py-2.5 bg-white shadow-sm border border-slate-100 rounded-2xl text-xs font-bold text-slate-600 active:scale-95 flex items-center gap-2 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F4F4F5]"
            >
              <span className="text-base">{action.emoji}</span> {action.text}
            </button>
          ))}
        </div>

        {previewUrl && (
          <div className="bg-white p-3 rounded-[1.5rem] shadow-xl border border-slate-100 mb-2 w-fit relative animate-slide-up">
            <img src={previewUrl} className="h-20 w-auto rounded-xl object-cover" alt="Preview" />
            <button
              onClick={clearAttachment}
              aria-label="Remove attachment"
              className="absolute -top-2 -right-2 w-6 h-6 bg-black text-white rounded-full flex items-center justify-center hover:bg-red-500 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div className="bg-white p-2 rounded-[2rem] shadow-xl border border-slate-100 flex items-center gap-2 relative">
          <button
            onClick={toggleListening}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
            aria-pressed={isListening}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${isListening ? 'bg-red-100 text-red-600 animate-pulse motion-reduce:animate-none' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach an image"
            className="w-11 h-11 rounded-full flex items-center justify-center text-slate-400 hover:text-lime-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <Paperclip size={20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
          />
          <form onSubmit={(e) => handleSendMessage(e)} className="flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder={isListening ? 'Listening...' : placeholders[placeholderIndex]}
              className="w-full bg-transparent border-none outline-none text-sm font-semibold text-slate-900 h-11 placeholder:text-slate-400"
            />
          </form>
          <button
            onClick={(e) => handleSendMessage(e)}
            disabled={!inputText.trim() && !attachment}
            aria-label="Send message"
            className={`w-11 h-11 rounded-full flex items-center justify-center shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${!inputText.trim() && !attachment ? 'bg-slate-100 text-slate-300 shadow-none cursor-not-allowed' : 'bg-black text-white hover:bg-lime-300 hover:text-black'}`}
          >
            <ArrowRight size={20} strokeWidth={3} />
          </button>
        </div>
      </div>
    </div>
  );
};
