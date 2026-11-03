"use client";

import { useActionState, useState, useTransition } from "react";
import type { Song } from "@/db/schema";
import { SubmitButton } from "@/components/SubmitButton";
import { inputClass } from "../../AddPlayerForm";
import { lookupAgain, updateSongDetails, type FormResult } from "../actions";

type Props = {
  song: Pick<Song, "id" | "title" | "artist" | "album" | "year" | "genre" | "artworkUrl" | "appleMusicUrl" | "spotifyUrl">;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

export function DetailsForm({ song }: Props) {
  const [result, formAction] = useActionState<FormResult, FormData>(updateSongDetails, null);
  const [lookupNote, setLookupNote] = useState<FormResult>(null);
  const [pending, startTransition] = useTransition();

  return (
    // key: re-mount with fresh values after a lookup changes them
    <form key={`${song.year}-${song.genre}-${song.artworkUrl}`} action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="id" value={song.id} />
      <Field label="Title">
        <input name="title" defaultValue={song.title} required maxLength={200} className={inputClass} />
      </Field>
      <Field label="Artist">
        <input name="artist" defaultValue={song.artist} required maxLength={200} className={inputClass} />
      </Field>
      <Field label="Album">
        <input name="album" defaultValue={song.album ?? ""} maxLength={200} className={inputClass} />
      </Field>
      <div className="grid grid-cols-[100px_1fr] gap-3">
        <Field label="Year">
          <input name="year" defaultValue={song.year ?? ""} inputMode="numeric" maxLength={4} className={inputClass} />
        </Field>
        <Field label="Genre">
          <input name="genre" defaultValue={song.genre ?? ""} maxLength={80} className={inputClass} />
        </Field>
      </div>
      <Field label="Apple Music link">
        <input name="appleMusicUrl" defaultValue={song.appleMusicUrl ?? ""} placeholder="Empty: link to a search" className={inputClass} />
      </Field>
      <Field label="Spotify link">
        <input name="spotifyUrl" defaultValue={song.spotifyUrl ?? ""} placeholder="Empty: link to a search" className={inputClass} />
      </Field>
      <Field label="Artwork image link">
        <input name="artworkUrl" defaultValue={song.artworkUrl ?? ""} className={inputClass} />
      </Field>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Saving…" className="px-4 py-2 text-sm">
          Save details
        </SubmitButton>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => setLookupNote(await lookupAgain(song.id)))}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-line disabled:opacity-50"
        >
          {pending ? "Looking up…" : "Look up again"}
        </button>
      </div>
      <p className="text-xs text-muted">“Look up again” searches the saved title and artist; save any changes first.</p>
      {result && <p className={`text-sm ${result.ok ? "text-accent" : "text-danger"}`}>{result.message}</p>}
      {lookupNote && <p className={`text-sm ${lookupNote.ok ? "text-accent" : "text-danger"}`}>{lookupNote.message}</p>}
    </form>
  );
}
