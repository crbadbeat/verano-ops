"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  uploadAvatar,
  removeAvatar,
  type AvatarState,
} from "@/app/admin/employees/avatar-actions";

// Crop stage is a square of S px, previewed as a circle. The exported image is
// always 256×256 regardless of S, so the two are kept equal for a 1:1 preview.
const S = 256;
// Small live preview beside the stage.
const P = 88;

/** First + last initial, uppercased. Falls back to "?" for an empty name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * The current avatar as a round image, with a graceful cascade:
 *   0 = stored photo → 1 = shared rep flame → 2 = initials circle.
 * `version` (avatarUpdatedAt in ms) busts the cache; null means no photo, so we
 * start at the flame. Advancing happens on each <img> onError.
 */
function Avatar({
  employeeId,
  name,
  version,
  size,
}: {
  employeeId: string;
  name: string;
  version: number | null;
  size: number;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(version != null ? 0 : 1);

  // A new version (photo saved/removed) restarts the cascade.
  useEffect(() => {
    setStage(version != null ? 0 : 1);
  }, [version]);

  const box = { width: size, height: size } as const;

  if (stage === 0 && version != null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- byte-served route, not a static asset
      <img
        src={`/api/employees/${employeeId}/avatar?v=${version}`}
        alt={name}
        width={size}
        height={size}
        style={box}
        className="rounded-full object-cover bg-surface-2 border border-border"
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- optional shared asset that may be absent
      <img
        src="/rep-flame.png"
        alt={name}
        width={size}
        height={size}
        style={box}
        className="rounded-full object-cover bg-surface-2 border border-border"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div
      style={box}
      className="rounded-full bg-surface-2 border border-border grid place-items-center font-semibold text-muted"
      role="img"
      aria-label={name}
    >
      <span style={{ fontSize: Math.round(size * 0.36) }}>{initialsOf(name)}</span>
    </div>
  );
}

export default function AvatarUploader({
  employeeId,
  name,
  version,
}: {
  employeeId: string;
  name: string;
  version: number | null;
}) {
  const router = useRouter();
  const fileId = useId();
  const zoomId = useId();

  const [uploadState, dispatchUpload, uploadPending] = useActionState<AvatarState, FormData>(
    uploadAvatar,
    {}
  );
  const [removeState, dispatchRemove, removePending] = useActionState<AvatarState, FormData>(
    removeAvatar,
    {}
  );

  const [editing, setEditing] = useState(false);
  // Error notice to surface (successes close the editor instead of lingering).
  const [notice, setNotice] = useState<AvatarState | null>(null);

  // Picked-image state. `src` is an object URL we own and must revoke.
  const [src, setSrc] = useState<string | null>(null);
  const srcRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Natural (intrinsic) size of the picked image, once loaded.
  const [nat, setNat] = useState<{ nw: number; nh: number } | null>(null);
  const [zoom, setZoom] = useState(1); // 1 → 3
  const [off, setOff] = useState<{ ox: number; oy: number }>({ ox: 0, oy: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Derived cover geometry. base fills the stage at zoom 1; scale applies zoom.
  const base = nat ? Math.max(S / nat.nw, S / nat.nh) : 1;
  const scale = base * zoom;
  const dw = nat ? nat.nw * scale : 0;
  const dh = nat ? nat.nh * scale : 0;

  /** Keep the image covering the stage: ox ∈ [S-dw, 0], oy ∈ [S-dh, 0]. */
  function clamp(ox: number, oy: number, w: number, h: number) {
    return {
      ox: Math.min(0, Math.max(S - w, ox)),
      oy: Math.min(0, Math.max(S - h, oy)),
    };
  }

  function resetCrop() {
    if (srcRef.current) {
      URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    }
    setSrc(null);
    setNat(null);
    setZoom(1);
    setOff({ ox: 0, oy: 0 });
  }

  // Revoke any outstanding object URL on unmount.
  useEffect(() => {
    return () => {
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    };
  }, []);

  // On a successful upload: refresh server data, close, and reset. Errors show.
  useEffect(() => {
    if (uploadState.ok) {
      router.refresh();
      setEditing(false);
      setNotice(null);
      resetCrop();
    } else if (uploadState.message) {
      setNotice(uploadState);
    }
  }, [uploadState, router]);

  // Same for a successful remove.
  useEffect(() => {
    if (removeState.ok) {
      router.refresh();
      setEditing(false);
      setNotice(null);
      resetCrop();
    } else if (removeState.message) {
      setNotice(removeState);
    }
  }, [removeState, router]);

  function pickFile(file: File) {
    if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    const url = URL.createObjectURL(file);
    srcRef.current = url;
    setSrc(url);
    setNat(null);
    setZoom(1);
    setOff({ ox: 0, oy: 0 });
    setNotice(null);
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const im = e.currentTarget;
    const nw = im.naturalWidth;
    const nh = im.naturalHeight;
    if (!nw || !nh) return;
    const b = Math.max(S / nw, S / nh);
    const dw0 = nw * b;
    const dh0 = nh * b;
    setNat({ nw, nh });
    setZoom(1);
    setOff({ ox: (S - dw0) / 2, oy: (S - dh0) / 2 }); // centered
  }

  function onZoom(next: number) {
    if (!nat) {
      setZoom(next);
      return;
    }
    const b = Math.max(S / nat.nw, S / nat.nh);
    const oldScale = b * zoom;
    const newScale = b * next;
    // Hold the stage-center point fixed so zoom feels centered.
    const cx = S / 2;
    const cy = S / 2;
    const imgX = (cx - off.ox) / oldScale;
    const imgY = (cy - off.oy) / oldScale;
    const nextOx = cx - imgX * newScale;
    const nextOy = cy - imgY * newScale;
    const nw = nat.nw * newScale;
    const nh = nat.nh * newScale;
    setZoom(next);
    setOff(clamp(nextOx, nextOy, nw, nh));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!nat) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setOff((o) => clamp(o.ox + dx, o.oy + dy, dw, dh));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));
  }

  async function onSave() {
    const im = imgRef.current;
    if (!im || !nat) return;
    // Visible source rectangle, in natural-image coordinates.
    const sx = -off.ox / scale;
    const sy = -off.oy / scale;
    const sSize = S / scale;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setNotice({ ok: false, message: "Could not process the image on this device." });
      return;
    }
    ctx.drawImage(im, sx, sy, sSize, sSize, 0, 0, 256, 256);

    let blob = await toBlob(canvas, "image/webp");
    let filename = "avatar.webp";
    if (!blob) {
      blob = await toBlob(canvas, "image/jpeg");
      filename = "avatar.jpg";
    }
    if (!blob) {
      setNotice({ ok: false, message: "Could not export the image — try a different photo." });
      return;
    }

    const fd = new FormData();
    fd.append("employeeId", employeeId);
    fd.append("image", blob, filename);
    dispatchUpload(fd);
  }

  function onRemove() {
    const fd = new FormData();
    fd.append("employeeId", employeeId);
    dispatchRemove(fd);
  }

  function openEditor() {
    setNotice(null);
    setEditing(true);
  }

  function cancelEditor() {
    resetCrop();
    setNotice(null);
    setEditing(false);
  }

  const busy = uploadPending || removePending;
  const hasPhoto = version != null;
  const previewScale = P / S;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar employeeId={employeeId} name={name} version={version} size={72} />
        {!editing && (
          <button type="button" className="btn btn-ghost text-sm" onClick={openEditor}>
            {hasPhoto ? "Change photo" : "Add photo"}
          </button>
        )}
      </div>

      {editing && (
        <div className="card p-5 space-y-4">
          <div>
            <label htmlFor={fileId} className="block text-sm text-muted">
              Choose a photo
            </label>
            <input
              id={fileId}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
              className="input mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-foreground"
            />
          </div>

          {src && (
            <>
              <div className="flex flex-wrap items-center gap-6">
                {/* Interactive circular crop stage. */}
                <div
                  className="relative overflow-hidden rounded-full bg-surface-2 border border-border select-none touch-none cursor-grab active:cursor-grabbing shrink-0"
                  style={{ width: S, height: S, touchAction: "none" }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  role="application"
                  aria-label="Drag to reposition the photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static asset */}
                  <img
                    ref={imgRef}
                    src={src}
                    alt=""
                    draggable={false}
                    onLoad={onImageLoad}
                    onDragStart={(e) => e.preventDefault()}
                    style={{
                      position: "absolute",
                      left: off.ox,
                      top: off.oy,
                      width: dw,
                      height: dh,
                      maxWidth: "none",
                      pointerEvents: "none",
                    }}
                  />
                </div>

                {/* Live preview of the exported crop. */}
                <div className="space-y-2">
                  <span className="block text-xs text-teal">Preview</span>
                  <div
                    className="relative overflow-hidden rounded-full bg-surface-2 border border-border shrink-0"
                    style={{ width: P, height: P }}
                    aria-hidden="true"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static asset */}
                    <img
                      src={src}
                      alt=""
                      draggable={false}
                      style={{
                        position: "absolute",
                        left: off.ox * previewScale,
                        top: off.oy * previewScale,
                        width: dw * previewScale,
                        height: dh * previewScale,
                        maxWidth: "none",
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor={zoomId} className="block text-sm text-muted">
                  Zoom
                </label>
                <input
                  id={zoomId}
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => onZoom(parseFloat(e.target.value))}
                  disabled={!nat}
                  className="mt-1 w-full max-w-sm accent-ember"
                />
                <p className="mt-1 text-xs text-muted">Drag the photo to reposition; slide to zoom.</p>
              </div>
            </>
          )}

          {notice?.message && (
            <p className={`text-sm ${notice.ok ? "text-teal" : "text-danger"}`}>{notice.message}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary text-sm"
              onClick={onSave}
              disabled={!nat || busy}
            >
              {uploadPending ? "Saving…" : "Save photo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              onClick={cancelEditor}
              disabled={busy}
            >
              Cancel
            </button>
            {hasPhoto && (
              <button
                type="button"
                className="btn btn-ghost text-sm text-danger ml-auto"
                onClick={onRemove}
                disabled={busy}
              >
                {removePending ? "Removing…" : "Remove photo"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
