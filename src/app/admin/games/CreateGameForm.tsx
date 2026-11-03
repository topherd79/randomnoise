"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { CLIP_LENGTHS } from "@/lib/clips";
import { GAME_LENGTHS, MAX_PLAYERS } from "@/lib/rules";
import { createGameAction, type FormResult } from "./actions";

type Player = { id: string; name: string; isMe: boolean };

function Option({ name, value, checked, disabled, onChange, children }: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition ${
        disabled ? "cursor-not-allowed border-line text-muted/50" : checked ? "border-accent bg-accent/10 text-ink" : "border-line text-ink hover:border-muted"
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

export function CreateGameForm({ players, unplayed, catalogSize }: { players: Player[]; unplayed: number; catalogSize: number }) {
  const [result, formAction] = useActionState<FormResult, FormData>(createGameAction, null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(players.filter((p) => p.isMe).map((p) => p.id)));
  const fits = GAME_LENGTHS.filter((n) => n <= unplayed);
  const [songCount, setSongCount] = useState<number>(fits.includes(10) ? 10 : (fits[fits.length - 1] ?? 5));
  const [clipLength, setClipLength] = useState<number>(10);
  const [wrong, setWrong] = useState<"random" | "similar">("random");
  const canCreate = fits.length > 0 && catalogSize >= 4 && picked.size > 0;

  return (
    <form action={formAction} className="flex flex-col gap-6 rounded-2xl bg-surface p-5">
      <fieldset>
        <legend className="text-sm font-semibold text-muted">
          Players ({picked.size} of up to {MAX_PLAYERS})
        </legend>
        <div className="mt-2 flex flex-col gap-1.5">
          {players.map((p) => {
            const on = picked.has(p.id);
            return (
              <label key={p.id} className={`flex items-center gap-2 text-sm ${!on && picked.size >= MAX_PLAYERS ? "opacity-40" : ""}`}>
                <input
                  type="checkbox"
                  name="playerIds"
                  value={p.id}
                  checked={on}
                  disabled={!on && picked.size >= MAX_PLAYERS}
                  onChange={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                  className="size-4 accent-[#d6ff3f]"
                />
                {p.name}
                {p.isMe && <span className="text-xs text-muted">(you)</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-muted">Songs</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {GAME_LENGTHS.map((n) => (
            <Option key={n} name="songCount" value={String(n)} checked={songCount === n} disabled={n > unplayed} onChange={() => setSongCount(n)}>
              {n}
            </Option>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {unplayed} unplayed {unplayed === 1 ? "song" : "songs"} in the catalog.
          {unplayed < 25 && ` Add ${25 - unplayed} more for a 25-song game.`}
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-muted">Clip length</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CLIP_LENGTHS.map((n) => (
            <Option key={n} name="clipLengthSec" value={String(n)} checked={clipLength === n} onChange={() => setClipLength(n)}>
              {n} seconds
            </Option>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Songs with their own clip length or a custom clip keep it.</p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-muted">Wrong answers</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <Option name="wrongAnswers" value="random" checked={wrong === "random"} onChange={() => setWrong("random")}>
            Random songs
          </Option>
          <Option name="wrongAnswers" value="similar" checked={wrong === "similar"} onChange={() => setWrong("similar")}>
            Similar era and genre
          </Option>
        </div>
        <p className="mt-2 text-xs text-muted">
          {wrong === "similar"
            ? "Harder: wrong answers come from songs close in year and genre, so they're harder to rule out."
            : "Wrong answers are other catalog songs, picked at random."}
        </p>
      </fieldset>

      <SubmitButton pendingText="Cutting clips…" className={canCreate ? "" : "pointer-events-none opacity-40"}>
        Start the game
      </SubmitButton>
      {catalogSize < 4 && <p className="text-sm text-danger">Add at least 4 songs to the catalog first.</p>}
      <p className="-mt-3 text-xs text-muted">Players get a “Game on” email with a login button.</p>
      {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
    </form>
  );
}
