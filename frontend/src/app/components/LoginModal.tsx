'use client';

import { useState } from 'react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (clientId: string, clientSecret: string) => void;
}

export default function LoginModal({ isOpen, onClose, onConfirm }: LoginModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (clientId && clientSecret) {
      onConfirm(clientId, clientSecret);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Blizzard API Credentials Required</h2>
          <p className="mt-2 text-sm text-zinc-400">
            This instance of WhyLowDps is not configured with global Blizzard API keys. 
            Please provide your own to continue with login.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-zinc-300">Client ID</label>
            <input
              type="text"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter your Client ID"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50 transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium text-zinc-300">Client Secret</label>
            <input
              type="password"
              required
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter your Client Secret"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50 transition-all"
            />
          </div>

          <div className="bg-gold/5 rounded-lg p-3 text-[12px] text-gold/80 border border-gold/10 leading-relaxed">
            You can create these on the{' '}
            <a 
              href="https://develop.battle.net/access/clients" 
              target="_blank" 
              rel="noopener noreferrer"
              className="underline hover:text-gold transition-colors"
            >
              Blizzard Developer Portal
            </a>. 
            These will be saved to your profile and used for future sessions.
          </div>

          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!clientId || !clientSecret}
              className="flex-[2] rounded-lg bg-[#0074e0] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/10 hover:bg-[#005fb8] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Link & Proceed to Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
