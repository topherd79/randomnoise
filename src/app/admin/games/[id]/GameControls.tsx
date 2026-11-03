"use client";

import { useState, useTransition } from "react";
import { endGameAction, resetAttemptAction, type FormResult } from "../actions";

export function ResetButton({ gameId, gameSongId, userId, name }: { gameId: string; gameSongId: string; userId: string; name: string }) {
  const [note, setNote] = useState<FormResult>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex items-center gap-3">
      {note && <span className={`text-xs ${note.ok ? "text-accent" : "text-danger"}`}>{note.message}</span>}
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm(`Reset ${name}'s attempt at this song? Their answer (if any) is thrown away.`)) return;
          startTransition(async () => setNote(await resetAttemptAction(gameId, gameSongId, userId)));
        }}
        className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-50"
      >
        Reset attempt
      </button>
    </span>
  );
}

export function GameControls({ gameId }: { gameId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-t border-line pt-6">
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm("End this game now? Players see the standings so far. This can't be undone.")) return;
          startTransition(() => endGameAction(gameId));
        }}
        className="rounded-full px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
      >
        {pending ? "Ending…" : "End game"}
      </button>
      <p className="mt-1 text-xs text-muted">Songs nobody played yet go back into the unplayed pile.</p>
    </div>
  );
}
