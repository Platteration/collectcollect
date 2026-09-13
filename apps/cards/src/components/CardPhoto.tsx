"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { CardRecord } from "@/lib/types";

/**
 * A photo can be added, replaced or removed after the card exists. The add
 * page is not the only time someone has the card in hand: a card entered from
 * a spreadsheet has no photo, and a better shot of one that has is worth
 * keeping. The upload goes through the same route the add page uses, and the
 * card takes the photo's accent colour with it, as a scanned card does.
 */
export function CardPhoto({ card, onUpdated }: { card: CardRecord; onUpdated: (card: CardRecord) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const { uploads } = await api<{ uploads: Array<{ name: string; color: string | null }> }>("/api/uploads", { method: "POST", body: fd });
      const upload = uploads[0];
      if (!upload) throw new Error("The photo was not stored.");
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ imagePath: upload.name, accentColor: upload.color }),
      });
      onUpdated(res.card);
      setStatus(card.imagePath ? "Photo replaced." : "Photo added.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this card's photo? The card and its history stay; only the picture goes.")) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ imagePath: null, accentColor: null }),
      });
      onUpdated(res.card);
      setStatus("Photo removed.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Working…" : card.imagePath ? "Replace photo" : "Add a photo"}
        </button>
        {card.imagePath && (
          <button type="button" className="btn-secondary" onClick={remove} disabled={busy}>
            Remove photo
          </button>
        )}
        <input
          ref={input}
          id="card-photo"
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={card.imagePath ? "Replace photo" : "Add a photo"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attach(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-neutral-500">
          {status}
        </p>
      )}
    </div>
  );
}
