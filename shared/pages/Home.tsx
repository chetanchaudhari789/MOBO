import React, { useEffect } from 'react';
import { Chatbot } from '../components/Chatbot';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { Lock } from 'lucide-react';

interface HomeProps {
  onVoiceNavigate?: (tab: 'home' | 'explore' | 'orders' | 'profile') => void;
}

export const Home: React.FC<HomeProps> = ({ onVoiceNavigate }) => {
  const { user } = useAuth();
  const { showNotification } = useNotification();

  useEffect(() => {
    if (user) {
      if (user.walletPending > 0) {
        setTimeout(() => {
          showNotification({
            title: 'MY CASHBACK',
            message: (
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-black">₹{user.walletBalance}</span>
                <span className="text-xs font-bold text-zinc-500 flex items-center gap-1">
                  <Lock size={10} /> ₹{user.walletPending} pending
                </span>
              </div>
            ),
            type: 'info',
            duration: 0,
          });
        }, 1000);
      } else {
        setTimeout(() => {
          showNotification({
            title: 'LOOT ALERT',
            message: '🔥 Nike Air Jordan dropped to ₹4,999! Tap to view.',
            type: 'success',
            duration: 0,
          });
        }, 2000);
      }
    }
  }, [user]);

  return (
    <div className="h-full w-full flex flex-col relative bg-[#F4F4F5]">
      <Chatbot onNavigate={onVoiceNavigate} />
    </div>
  );
};
