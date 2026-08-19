'use client';

import { Camera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function pairingConsumeUrlFromValue(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/api/lan/pair' ||
      !url.searchParams.get('token')
    ) {
      return null;
    }
    url.pathname = '/api/lan/pair/consume';
    return url.toString();
  } catch {
    return null;
  }
}

export default function LanPairingScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [open, setOpen] = useState(false);
  const [cameraRequested, setCameraRequested] = useState(false);
  const [error, setError] = useState('');

  const finishScan = (value: string) => {
    const consumeUrl = pairingConsumeUrlFromValue(value);
    if (!consumeUrl) {
      setError('That is not a WhyLowDPS pairing QR code.');
      return;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    window.location.assign(consumeUrl);
  };

  useEffect(() => {
    if (!open || !cameraRequested || !videoRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;

        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result) => {
            if (result) finishScan(result.getText());
          }
        );
        if (cancelled) {
          controls.stop();
        } else {
          controlsRef.current = controls;
        }
      } catch {
        if (!cancelled) {
          setCameraRequested(false);
          setError('Camera access was unavailable. Use the button below to capture the QR code.');
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [cameraRequested, open]);

  const startScan = () => {
    setError('');
    setOpen(true);
    if (window.isSecureContext && 'mediaDevices' in navigator) {
      setCameraRequested(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  const closeScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraRequested(false);
    setOpen(false);
    setError('');
  };

  const readCapturedQr = async (file: File) => {
    setError('Reading QR code…');
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      const objectUrl = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(objectUrl);
        finishScan(result.getText());
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setError('Could not read that image. Point the camera at the desktop QR code and try again.');
    }
  };

  return (
    <div className="w-full space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readCapturedQr(file);
        }}
      />

      {!open ? (
        <button
          type="button"
          onClick={startScan}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-bold text-black transition-colors hover:bg-gold/90"
        >
          <Camera className="h-5 w-5" />
          Scan desktop QR code
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-100">Scan the QR code on your PC</p>
            <button
              type="button"
              onClick={closeScanner}
              className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              aria-label="Close scanner"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {cameraRequested ? (
            <video
              ref={videoRef}
              className="aspect-square w-full rounded-lg bg-black object-cover"
              muted
              playsInline
            />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-zinc-200 hover:bg-white/10"
            >
              <Camera className="h-4 w-4" />
              Open camera
            </button>
          )}

          <p className="text-center text-xs text-zinc-500">
            Keep the QR code visible and make sure both devices are on the same Wi-Fi.
          </p>
          {error && <p className="text-center text-xs text-amber-200">{error}</p>}
        </div>
      )}
    </div>
  );
}
