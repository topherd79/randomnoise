"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { CLIP_LENGTHS } from "@/lib/clips";
import { MAX_PLAYERS } from "@/lib/rules";
import { GAME_MODES, MODES, type GameMode } from "@/lib/modes";
import { createGameAction, type FormResult } from "./actions";
import { matchesFilters, type SongMeta } from "@/lib/song-filters";
import { SongFilterPicker, type FilterState } from "./SongFilterPicker";

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

const NO_FILTER_STATE: FilterState = { decades: new Set(), genres: new Set(), artists: [] };

/** songs: every switched-on song's artist, year, genre and whether a game has used it (no titles). */
export function CreateGameForm({ players, songs }: { players: Player[]; songs: SongMeta[] }) {
  const [result, formAction] = useActionState<FormResult, FormData>(createGameAction, null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(players.filter((p) => p.isMe).map((p) => p.id)));
  // The mode decides how many songs open at a time, and which game lengths there are.
  const [mode, setMode] = useState<GameMode>("og");
  const lengths = MODES[mode].lengths;
  const shortest = lengths[0];

  // Filters narrow which songs the game draws from; the counts below follow them live.
  const [filter, setFilter] = useState<FilterState>(NO_FILTER_STATE);
  const filtering = filter.decades.size > 0 || filter.genres.size > 0 || filter.artists.length > 0;
  const matching = useMemo(
    () =>
      songs.filter((s) =>
        matchesFilters(s, { decades: [...filter.decades], genres: [...filter.genres], artists: filter.artists.map((a) => a.key) }),
      ),
    [songs, filter],
  );
  // catalogSize counts matching switched-on songs; unplayed is those no game has used.
  const catalogSize = matching.length;
  const unplayed = matching.filter((s) => !s.played).length;

  const fitting = (p: Pool, m: GameMode = mode): number[] =>
    MODES[m].lengths.filter((n) => n <= (p === "mix" ? catalogSize : unplayed));
  const pickCount = (list: number[], m: GameMode = mode) =>
    list.includes(MODES[m].defaultLength) ? MODES[m].defaultLength : (list[list.length - 1] ?? MODES[m].lengths[0]);
  // If there aren't enough new songs left, start on "include earlier songs" so you're never stuck.
  const [autoMix] = useState(() => songs.filter((s) => !s.played).length < MODES.og.lengths[0]);
  const [pool, setPool] = useState<Pool>(() => (autoMix ? "mix" : "new"));
  const fits = fitting(pool);
  const [chosenCount, setSongCount] = useState<number>(() => pickCount(fits));
  // When filters shrink the pool, fall back to the longest game that still fits.
  const songCount = fits.includes(chosenCount) ? chosenCount : pickCount(fits);
  const [clipLength, setClipLength] = useState<number>(10);
  const [wrong, setWrong] = useState<"random" | "similar">("random");
  const canCreate = fits.length > 0 && picked.size > 0;
  const repeats = Math.max(0, songCount - unplayed);

  function choosePool(p: Pool) {
    setPool(p);
    const next = fitting(p);
    if (!next.includes(songCount)) setSongCount(pickCount(next));
  }

  function chooseMode(m: GameMode) {
    setMode(m);
    // Keep the length if the new mode has it (10 in The OG → 10 in All songs), else that mode's usual one.
    const next = fitting(pool, m);
    setSongCount(next.includes(songCount) ? songCount : pickCount(next, m));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6 rounded-2xl bg-surface p-5">
      <fieldset>
        <legend className="text-sm font-semibold text-muted">Game mode</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {GAME_MODES.map((m) => (
            <Option key={m} name="mode" value={m} checked={mode === m} onChange={() => chooseMode(m)}>
              {MODES[m].name}
            </Option>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{MODES[mode].description}</p>
      </fieldset>

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
        <legend className="flex w-full items-baseline justify-between text-sm font-semibold text-muted">
          <span>Filters (optional)</span>
          {filtering && (
            <button type="button" onClick={() => setFilter(NO_FILTER_STATE)} className="text-xs font-medium text-muted underline hover:text-ink">
              Clear
            </button>
          )}
        </legend>
        <div className="mt-2">
          <SongFilterPicker songs={songs} value={filter} onChange={setFilter} />
        </div>
        <p className={`mt-3 text-xs ${filtering ? "font-semibold text-ink" : "text-muted"}`}>
          {filtering
            ? `${catalogSize} ${catalogSize === 1 ? "song matches" : "songs match"} (${unplayed} new). Wrong answers come from these songs too when there are enough.`
            : "Leave empty to use the whole catalog. Within a filter any ticked option counts; across filters a song must match all of them."}
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-muted">Songs</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {lengths.map((n) => (
            <Option key={n} name="songCount" value={String(n)} checked={songCount === n} disabled={!fits.includes(n)} onChange={() => setSongCount(n)}>
              {n}
            </Option>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {unplayed} new {unplayed === 1 ? "song" : "songs"} (switched on, not played yet)
          {catalogSize > unplayed && ` and ${catalogSize - unplayed} from earlier games`}
          {filtering && " match the filters"}.
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
          {pool === "mix" && autoMix && " Picked for you: there aren't enough new songs left for a game."}
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
          {filtering && catalogSize < shortest ? (
            <>
              Only {catalogSize} switched-on {catalogSize === 1 ? "song matches" : "songs match"} these filters, and the
              shortest game needs {shortest}. Tick more options or clear a filter.
            </>
          ) : pool === "new" && catalogSize >= shortest ? (
            <>
              Not enough new songs to start a game: only {unplayed} {filtering ? "matching " : ""}
              {unplayed === 1 ? "song hasn't" : "songs haven't"} been played, and the shortest game needs {shortest}. Pick &ldquo;Include songs from earlier games&rdquo;
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
