"use client";

import { useId, useMemo, useRef, useState } from "react";
import { chipCounts, decadeOf, filterKey, type SongMeta } from "@/lib/song-filters";
import { genreList } from "@/lib/genres";

export type FilterState = {
  decades: Set<number>;
  /** Genres in the game (green) and genres left out (red); a genre is in at most one. */
  genres: Set<string>;
  excludeGenres: Set<string>;
  /** In the order they were added; key is filterKey(name). */
  artists: { key: string; name: string }[];
};

type Option<K> = { key: K; label: string; count: number };

/** Group by a normalized key, label each group with its most common spelling. */
function groupOptions(values: string[]): Option<string>[] {
  const groups = new Map<string, Map<string, number>>();
  for (const v of values) {
    const key = filterKey(v);
    if (!key) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(v.trim(), (spellings.get(v.trim()) ?? 0) + 1);
    groups.set(key, spellings);
  }
  return [...groups.entries()].map(([key, spellings]) => {
    const [label] = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0];
    return { key, label, count: [...spellings.values()].reduce((a, b) => a + b, 0) };
  });
}

/** Shown on a chip that's off and would leave no songs with the other picks. */
const NONE_LEFT = "No songs left with your other picks";

function Chip({
  checked,
  onChange,
  name,
  value,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  value: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      title={disabled ? NONE_LEFT : undefined}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
        checked
          ? "cursor-pointer border-accent bg-accent/10 text-ink"
          : disabled
            ? "cursor-not-allowed border-line text-ink opacity-35"
            : "cursor-pointer border-line text-ink hover:border-muted"
      }`}
    >
      <input type="checkbox" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

type GenreState = "off" | "in" | "out";
const NEXT: Record<GenreState, GenreState> = { off: "in", in: "out", out: "off" };
const SAYS: Record<GenreState, string> = { off: "not filtered", in: "included", out: "left out" };

/**
 * A genre chip that cycles with each tap: off → included (green) → left out
 * (red) → off. Submits as a genre or excludeGenre form field.
 */
function GenreChip({
  label,
  state,
  value,
  disabled = false,
  onNext,
  children,
}: {
  label: string;
  state: GenreState;
  value: string;
  disabled?: boolean;
  onNext: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onNext}
      disabled={disabled}
      title={disabled ? NONE_LEFT : undefined}
      aria-label={`${label}: ${SAYS[state]}. ${disabled ? `${NONE_LEFT}.` : `Tap to ${state === "off" ? "include" : state === "in" ? "leave out" : "clear"}.`}`}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
        state === "in"
          ? "border-accent bg-accent/10 text-ink"
          : state === "out"
            ? "border-danger bg-danger/10 text-danger"
            : disabled
              ? "cursor-not-allowed border-line text-ink opacity-35"
              : "border-line text-ink hover:border-muted"
      }`}
    >
      {state === "in" && <input type="hidden" name="genre" value={value} />}
      {state === "out" && <input type="hidden" name="excludeGenre" value={value} />}
      {state === "out" && <span aria-hidden="true">− </span>}
      <span className={state === "out" ? "line-through decoration-1" : ""}>{children}</span>
    </button>
  );
}

/**
 * Decade checkboxes, genre chips (include or leave out) and an artist
 * type-ahead (their songs come first) for the "Start a game" form. Ticked options submit as decade /
 * genre / excludeGenre / artist form fields.
 */
export function SongFilterPicker({
  songs,
  newOnly = false,
  value,
  onChange,
}: {
  songs: SongMeta[];
  /** "New songs only": chip counts leave out songs a game has used. */
  newOnly?: boolean;
  value: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const decadeOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of songs) if (s.year !== null) counts.set(decadeOf(s.year), (counts.get(decadeOf(s.year)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([key, count]) => ({ key, label: `${key}s`, count }));
  }, [songs]);
  const genreOptions = useMemo(
    // One chip per genre: a Pop/Rock song counts under Pop and under Rock.
    () => groupOptions(songs.flatMap((s) => genreList(s.genre))).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    [songs],
  );
  const artistOptions = useMemo(() => groupOptions(songs.map((s) => s.artist)).sort((a, b) => a.label.localeCompare(b.label)), [songs]);
  // The chips stay put (every decade and genre in the catalog); their counts
  // follow the other picks, and a chip that's off and would leave no songs is dimmed.
  const live = useMemo(
    () =>
      chipCounts(newOnly ? songs.filter((s) => !s.played) : songs, {
        decades: [...value.decades],
        genres: [...value.genres],
        excludeGenres: [...value.excludeGenres],
        artists: [],
      }),
    [songs, newOnly, value.decades, value.genres, value.excludeGenres],
  );

  const setGenre = (v: FilterState, key: string, to: GenreState): FilterState => {
    const genres = new Set(v.genres);
    const excludeGenres = new Set(v.excludeGenres);
    genres.delete(key);
    excludeGenres.delete(key);
    if (to === "in") genres.add(key);
    if (to === "out") excludeGenres.add(key);
    return { ...v, genres, excludeGenres };
  };

  const toggle = <K,>(set: Set<K>, key: K) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      {decadeOptions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Decades</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {decadeOptions.map((o) => {
              const n = live.decades.get(o.key) ?? 0;
              const on = value.decades.has(o.key);
              return (
                <Chip
                  key={o.key}
                  name="decade"
                  value={String(o.key)}
                  checked={on}
                  disabled={!on && n === 0}
                  onChange={() => onChange({ ...value, decades: toggle(value.decades, o.key) })}
                >
                  {o.label} <span className="font-normal text-muted">{n}</span>
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      {genreOptions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Genres <span className="font-normal normal-case tracking-normal">· tap to include, again to leave out, again to clear</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {genreOptions.map((o) => {
              const state: GenreState = value.genres.has(o.key) ? "in" : value.excludeGenres.has(o.key) ? "out" : "off";
              const n = live.genres.get(o.key) ?? 0;
              return (
                <GenreChip
                  key={o.key}
                  label={o.label}
                  value={o.key}
                  state={state}
                  disabled={state === "off" && n === 0}
                  onNext={() => onChange(setGenre(value, o.key, NEXT[state]))}
                >
                  {o.label} <span className={`font-normal ${state === "out" ? "text-danger/70" : "text-muted"}`}>{n}</span>
                </GenreChip>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Artists <span className="font-normal normal-case tracking-normal">· their songs come first</span>
        </p>
        <ArtistPicker
          options={artistOptions}
          selected={value.artists}
          onAdd={(a) => onChange({ ...value, artists: [...value.artists, a] })}
          onRemove={(key) => onChange({ ...value, artists: value.artists.filter((a) => a.key !== key) })}
        />
      </div>
    </div>
  );
}

/** Type a few letters, pick from the suggestions; each pick becomes a removable chip. */
function ArtistPicker({
  options,
  selected,
  onAdd,
  onRemove,
}: {
  options: Option<string>[];
  selected: { key: string; name: string }[];
  onAdd: (a: { key: string; name: string }) => void;
  onRemove: (key: string) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const query = filterKey(text);
  const taken = new Set(selected.map((a) => a.key));
  const suggestions = query
    ? options
        .filter((o) => !taken.has(o.key) && o.key.includes(query))
        // Names that start with what you typed come first.
        .sort((a, b) => Number(!a.key.startsWith(query)) - Number(!b.key.startsWith(query)) || a.label.localeCompare(b.label))
        .slice(0, 8)
    : [];
  const showList = open && suggestions.length > 0;

  function add(o: Option<string>) {
    onAdd({ key: o.key, name: o.label });
    setText("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Never submit the whole form from this box.
      e.preventDefault();
      if (showList && suggestions[active]) add(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && text === "" && selected.length > 0) {
      onRemove(selected[selected.length - 1].key);
    }
  }

  return (
    <div className="mt-1.5">
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Artists whose songs come first">
          {selected.map((a) => (
            <li key={a.key} className="flex items-center gap-1 rounded-lg border border-accent bg-accent/10 py-1 pl-2.5 pr-1 text-xs font-semibold text-ink">
              <input type="hidden" name="artist" value={a.key} />
              {a.name}
              <button
                type="button"
                onClick={() => onRemove(a.key)}
                aria-label={`Remove ${a.name}`}
                className="flex size-5 items-center justify-center rounded-md text-muted hover:bg-line hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={options.length ? "Type an artist's name" : "No artists in the catalog yet"}
          disabled={options.length === 0}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          autoComplete="off"
          className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-xl border border-line bg-surface-2 py-1 shadow-lg"
          >
            {suggestions.map((o, i) => (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: it fires before the input loses focus and closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-line text-ink" : "text-ink"}`}
              >
                <span className="truncate">{o.label}</span>
                <span className="shrink-0 text-xs text-muted">
                  {o.count} {o.count === 1 ? "song" : "songs"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
