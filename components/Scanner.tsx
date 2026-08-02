"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Minimal typing for the browser BarcodeDetector API (not in lib.dom yet).
type DetectedBarcode = { rawValue: string };
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

// jsQR gets slow on large frames; cap the analyzed image to this width.
const MAX_SCAN_WIDTH = 640;

export default function Scanner({
  onDetected,
  label = "Scan QR code",
}: {
  onDetected: (rawValue: string) => void;
  /** Idle-state button text, so each screen names what it scans. */
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);

  useEffect(() => {
    setHasCamera(
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    );
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let frame = 0;

    // Native detector where available (Chrome/Android); jsQR fallback elsewhere (iOS).
    const NativeDetector = window.BarcodeDetector;
    const nativeDetector = NativeDetector
      ? new NativeDetector({ formats: ["qr_code"] })
      : null;

    function decodeWithCanvas(video: HTMLVideoElement): string | null {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      const scale = Math.min(1, MAX_SCAN_WIDTH / vw);
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const result = jsQR(data, w, h, { inversionAttempts: "dontInvert" });
      return result?.data ?? null;
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iOS Safari needs these + a played gesture (the Scan button click).
        video.setAttribute("playsinline", "true");
        await video.play();

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          frame++;
          try {
            let value: string | null = null;
            if (nativeDetector) {
              const codes = await nativeDetector.detect(videoRef.current);
              value = codes[0]?.rawValue ?? null;
            } else if (frame % 3 === 0) {
              // Throttle the CPU-heavy jsQR path to ~every 3rd frame.
              value = decodeWithCanvas(videoRef.current);
            }
            if (value) {
              onDetected(value);
              setScanning(false);
              return;
            }
          } catch {
            /* transient decode error — keep going */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setError(cameraErrorMessage(e));
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, onDetected]);

  if (hasCamera === false) {
    return (
      <div className="card p-5 text-sm text-muted">
        No camera is available on this device. Enter the trip details from the pick
        sheet below.
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black/60 relative">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />
        {!scanning && (
          <div className="absolute inset-0 grid place-items-center text-muted text-sm">
            Camera off
          </div>
        )}
        {scanning && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-40 w-40 rounded-xl border-2 border-ember/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => {
          setError(null);
          setScanning((s) => !s);
        }}
        className={`btn mt-4 w-full ${scanning ? "btn-ghost" : "btn-primary"}`}
      >
        {scanning ? "Stop camera" : label}
      </button>
    </div>
  );
}

function cameraErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotAllowedError")
    return "Camera permission was denied. Allow camera access and try again.";
  if (err?.name === "NotFoundError") return "No camera found on this device.";
  // Camera requires a secure context (https) except on localhost.
  if (
    typeof window !== "undefined" &&
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost"
  ) {
    return "Camera needs a secure (https) connection. Open the app over https and try again.";
  }
  return err?.message ?? "Could not start the camera.";
}
