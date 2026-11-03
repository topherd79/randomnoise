"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCustomClip, type FormResult } from "../actions";

export function CustomClipPanel({ songId, hasClip, version }: { songId: string; hasClip: boolean; version: number }) {
  const router = useRouter();
  const [note, setNote] = useState<FormResult>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/songs/${songId}/custom-clip`, {
        method: "POST",
        headers: { "X-File-Name": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
        body: file,
      });
      const json = (await res.json().catch(() => ({ ok: false, error: "Upload failed." }))) as { ok: boolean; error?: string };
      setNote(json.ok ? { ok: true, message: "Custom clip saved." } : { ok: false, message: json.error ?? "Upload failed." });
      if (json.ok) router.refresh();
    } catch {
      setNote({ ok: false, message: "The connection dropped. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {hasClip && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-surface p-4">
          <audio controls preload="none" src={`/api/admin/songs/${songId}/custom-clip?v=${version}`} className="h-10" />
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setNote(await removeCustomClip(songId));
                router.refresh();
              })
            }
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            Remove custom clip
          </button>
        </div>
      )}
      <label className="w-fit cursor-pointer rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-line">
        {busy ? "Uploading…" : hasClip ? "Replace custom clip" : "Upload a custom clip"}
        <input
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.aif,.aiff"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
      </label>
      {note && <p className={`text-sm ${note.ok ? "text-accent" : "text-danger"}`}>{note.message}</p>}
    </div>
  );
}
