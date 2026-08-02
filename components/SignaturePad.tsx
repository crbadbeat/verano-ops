"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draw-to-sign pad. The captured PNG data URL rides along in a hidden input, so
 * it submits with the surrounding server-action form like any other field.
 */
export default function SignaturePad({
  name,
  label = "Driver signature",
}: {
  name: string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dataUrl, setDataUrl] = useState("");

  const fillWhite = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);

  // Paint a white background so the exported PNG isn't transparent.
  useEffect(() => {
    fillWhite();
  }, [fillWhite]);

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pointAt(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { x, y } = pointAt(e);
    ctx.strokeStyle = "#0b1120";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const c = canvasRef.current;
    if (c) setDataUrl(c.toDataURL("image/png"));
  }

  function clear() {
    fillWhite();
    setDataUrl("");
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">{label}</span>
        {dataUrl && <span className="badge text-success">signed</span>}
        <button
          type="button"
          onClick={clear}
          className="btn btn-ghost py-1 px-2 text-xs ml-auto"
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="mt-1 w-full rounded-xl border border-border bg-white touch-none cursor-crosshair"
      />
      <input type="hidden" name={name} value={dataUrl} />
    </div>
  );
}
