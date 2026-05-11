import { CheckCircle2, X } from 'lucide-react';

type ClipboardBannerProps = {
  message: string;
  onDismiss: () => void;
};

export default function ClipboardBanner({ message, onDismiss }: ClipboardBannerProps) {
  return (
    <div className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-500/25 bg-zinc-950/95 p-4 text-sm text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-emerald-100">Clipboard pasted</p>
          <p className="mt-1 text-[13px] leading-5 text-zinc-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
