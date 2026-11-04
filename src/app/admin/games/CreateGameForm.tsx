"use client";

import Link from "next/link";
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

type Pool = "new" | "mix";

export function CreateGameForm({ players, unplayed, catalogSize }: { players: Player[]; unplayed: number; catalogSize: number }) {
  const [result, formAction] = useActionState<FormResult, FormData>(createGameAction, null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(players.filter((p) => p.isMe).map((p) => p.id)));
  const shortest = GAME_LENGTHS[0];
  // catalogSize counts switched-on songs; unplayed is the switched-on songs no game has used.
  const fitting = (p: Pool): number[] => GAME_LENGTHS.filter((n) => n <= (p === "mix" ? catalogSize : unplayed));
  const pickCount = (list: number[]) => (list.includes(10) ? 10 : (list[list.length - 1] ?? shortest));
  // If there aren't enough new songs left, start on "include earlier songs" so you're never stuck.
  const [pool, setPool] = useState<Pool>(() => (unplayed >= shortest ? "new" : "mix"));
  const fits = fitting(pool);
  const [songCount, setSongCount] = useState<number>(() => pickCount(fits));
  const [clipLength, setClipLength] = useState<number>(10);
  const [wrong, setWrong] = useState<"random" | "similar">("random");
  const canCreate = fits.length > 0 && picked.size > 0;
  const repeats = Math.max(0, songCount - unplayed);

  function choosePool(p: Pool) {
    setPool(p);
    const next = fitting(p);
    if (!next.includes(songCount)) setSongCount(pickCount(next));
  }

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
            <Option key={n} name="songCount" value={String(n)} checked={songCount === n} disabled={!fits.includes(n)} onChange={() => setSongCount(n)}>
              {n}
            </Option>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {unplayed} new {unplayed === 1 ? "song" : "songs"} (switched on, not played yet)
          {catalogSize > unplayed && ` and ${catalogSize - unplayed} from earlier games`}.
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-muted">Which songs</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <Option name="songPool" value="new" checked={pool === "new"} onChange={() => choosePool("new")}>
            New songs only
          </Option>
          <Option name="songPool" value="mix" checked={pool === "mix"} onChange={() => choosePool("mix")}>
            Include songs from earlier games
          </Option>
        </div>
        <p className="mt-2 text-xs text-muted">
          {pool === "new"
            ? "Only songs no game has used yet."
            : repeats > 0
              ? `New songs first, then ${repeats} from earlier games (the ones played longest ago), mixed in at random. Players may remember those.`
              : "New songs first; songs from earlier games only fill in if there aren't enough new ones."}
          {pool === "mix" && unplayed < shortest && " Picked for you: there aren't enough new songs left for a game."}
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

      {/* Say why the button is greyed out instead of leaving it a mystery. */}
      {fits.length === 0 && (
        <p className="rounded-xl bg-danger/10 p-3 text-sm leading-relaxed text-danger" role="status">
          {pool === "new" && catalogSize >= shortest ? (
            <>
              Not enough new songs to start a game: only {unplayed} {unplayed === 1 ? "hasn't" : "haven't"} been
              played, and the shortest game needs {shortest}. Pick &ldquo;Include songs from earlier games&rdquo;
              above, or add at least {shortest - unplayed} more on the{" "}
              <Link href="/admin/catalog" className="font-semibold underline">
                Catalog page
              </Link>
              .
            </>
          ) : (
            <>
              The shortest game needs {shortest} songs, and only {catalogSize} {catalogSize === 1 ? "is" : "are"}{" "}
              switched on. Add or switch on at least {shortest - catalogSize} more on the{" "}
              <Link href="/admin/catalog" className="font-semibold underline">
                Catalog page
              </Link>
              .
            </>
          )}
        </p>
      )}
      {fits.length > 0 && picked.size === 0 && <p className="text-sm text-danger">Pick at least one player.</p>}
      <SubmitButton pendingText="Cutting clips…" className={canCreate ? "" : "pointer-events-none opacity-40"}>
        Start the game
      </SubmitButton>
      <p className="-mt-3 text-xs text-muted">Players get a “Game on” email with a login button, and one at the end with the full results.</p>
      {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
    </form>
  );
}
