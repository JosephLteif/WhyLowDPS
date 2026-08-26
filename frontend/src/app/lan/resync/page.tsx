'use client';

import LanPairingScanner from '../../components/LanPairingScanner';

export default function LanResyncPage() {
  return (
    <main className="flex min-h-[calc(100vh-var(--app-header-height)-3rem)] items-center justify-center py-8">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-gold/20 bg-surface/80 p-6 text-center shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-2xl text-gold">
          !
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-white">Access needs to be restored</h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            This device was unpaired from WhyLowDPS. Scan a new QR code from the desktop app to
            resync this browser.
          </p>
        </div>
        <LanPairingScanner />
        <p className="text-xs leading-relaxed text-zinc-500">
          On the desktop, open Settings → Share over LAN → New pairing link. Keep both devices on
          the same trusted Wi-Fi network.
        </p>
      </section>
    </main>
  );
}
