'use client';

import { useEffect, useState } from 'react';

const DISCORD_INVITE_URL = 'https://discord.gg/ZjxQv5kFxe';
const DISCORD_PROMPT_DISMISSED_KEY = 'whylowdps_discord_prompt_dismissed';

export default function DiscordInvitePrompt() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISCORD_PROMPT_DISMISSED_KEY) === '1';
    if (!dismissed) {
      setIsOpen(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISCORD_PROMPT_DISMISSED_KEY, '1');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111218] p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-zinc-100">Join our Discord</h2>
        <p className="mt-2 text-sm text-zinc-300">
          You can join the WhyLowDps Discord server anytime for updates, support, and feedback.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            Close
          </button>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={dismiss}
            className="rounded-md border border-[#5865F2]/50 bg-[#5865F2]/20 px-3 py-2 text-sm font-semibold text-[#cfd4ff] transition-colors hover:bg-[#5865F2]/30"
          >
            Join Discord
          </a>
        </div>
      </div>
    </div>
  );
}
