"use client";

import { useState, useTransition } from "react";
import { deleteSong, type FormResult } from "../actions";

export function DeleteSong({ songId, title }: { songId: string; title: string }) {
  const [note, setNote] = useState<FormResult>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-t border-line pt-6">
      <button
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              `Delete “${title}” from the catalog? The file is removed too.\n\nGames that used it keep their results; only their full-song player for it goes away.`,
            )
          )
            return;
          startTransition(async () => setNote(await deleteSong(songId)));
        }}
        className="rounded-full px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete song"}
      </button>
      {note && !note.ok && <p className="mt-2 text-sm text-danger">{note.message}</p>}
    </div>
  );
}
