import React from 'react';
import { Chatbot } from '../components/Chatbot';

interface HomeProps {
  onVoiceNavigate?: (tab: 'home' | 'explore' | 'orders' | 'profile') => void;
}

export const Home: React.FC<HomeProps> = ({ onVoiceNavigate }) => {
  // Notifications are server-backed; avoid seeded/mock toasts here.
  return (
    <div className="h-full w-full flex flex-col relative bg-[#F4F4F5]">
      <Chatbot onNavigate={onVoiceNavigate} />
    </div>
  );
};
