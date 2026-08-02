"use client";

import { useState } from "react";

/**
 * Shows a one-time invite link with a copy button. The link is displayed once
 * (the raw token is never stored), so the admin copies it here and sends it on.
 */
export default function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the readonly field is still selectable by hand.
    }
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="input font-mono text-xs flex-1"
        aria-label="Invite link"
      />
      <button type="button" onClick={copy} className="btn btn-ghost whitespace-nowrap">
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
