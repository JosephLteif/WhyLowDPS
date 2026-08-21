'use client';

import { Camera, X } from 'lucide-react';
import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

const MAX_CAPTURE_DIMENSION = 2_000;

type QrBarcodeDetector = new (options?: { formats?: string[] }) => {
  detect(source: HTMLImageElement): Promise<Array<{ rawValue?: string }>>;
};

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

async function decodeCapturedQr(file: File): Promise<string> {
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => resolve(String(fileReader.result));
    fileReader.onerror = () => reject(new Error('Could not read the captured image.'));
    fileReader.readAsDataURL(file);
  });
  const image = new Image();
  image.decoding = 'async';

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not load the captured image.'));
      image.src = imageDataUrl;
    });

    const BarcodeDetector = (window as typeof window & { BarcodeDetector?: QrBarcodeDetector })
      .BarcodeDetector;
    if (BarcodeDetector) {
      try {
        const [result] = await new BarcodeDetector({ formats: ['qr_code'] }).detect(image);
        if (result?.rawValue) return result.rawValue;
      } catch {
        // Fall through to ZXing for browsers without a usable native detector.
      }
    }

    const candidates: Array<HTMLImageElement | HTMLCanvasElement> = [];

    const addCenteredCrop = (fraction: number) => {
      const cropWidth = Math.round(image.naturalWidth * fraction);
      const cropHeight = Math.round(image.naturalHeight * fraction);
      if (cropWidth <= 0 || cropHeight <= 0) return;

      const cropScale = MAX_CAPTURE_DIMENSION / Math.max(cropWidth, cropHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(cropWidth * cropScale));
      canvas.height = Math.max(1, Math.round(cropHeight * cropScale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(
        image,
        (image.naturalWidth - cropWidth) / 2,
        (image.naturalHeight - cropHeight) / 2,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
      candidates.push(canvas);
    };

    addCenteredCrop(0.6);
    addCenteredCrop(0.8);
    addCenteredCrop(1);
    candidates.push(image);

    for (const candidate of candidates) {
      if (candidate instanceof HTMLCanvasElement) {
        try {
          const context = candidate.getContext('2d', { willReadFrequently: true });
          const imageData = context?.getImageData(0, 0, candidate.width, candidate.height);
          if (imageData) {
            const result = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (result?.data) return result.data;
          }
        } catch {}
      }
    }

    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const reader = new BrowserQRCodeReader();
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const result =
          candidate instanceof HTMLCanvasElement
            ? reader.decodeFromCanvas(candidate)
            : await reader.decodeFromImageElement(candidate);
        return result.getText();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('No QR code found.');
  } finally {
    image.src = '';
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
      finishScan(await decodeCapturedQr(file));
    } catch (error) {
      console.warn('[WhyLowDPS] QR image decode failed', {
        error,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      const format = file.type || file.name.split('.').pop() || 'unknown format';
      setError(
        `Could not read that image (${format}). Point the camera at the desktop QR code and try again.`
      );
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
