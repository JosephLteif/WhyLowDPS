import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface SimReturnNoticeProps {
  title: string;
  message?: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export default function SimReturnNotice({
  title,
  message,
  onDismiss,
  autoDismissMs = 3500,
}: SimReturnNoticeProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
      <div className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-amber-500/25 bg-zinc-950/95 p-4 text-sm text-amber-100 shadow-2xl shadow-black/40 backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-100">{title}</p>
            {message ? <p className="mt-1 text-[13px] leading-5 text-zinc-300">{message}</p> : null}
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
    </div>
  );
}
