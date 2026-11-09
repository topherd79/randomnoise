"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTime } from "@/lib/clips";
import type { LookupStatus } from "@/db/schema";
import { decadeOf, filterKey } from "@/lib/song-filters";
import { ActiveSwitch } from "./ActiveSwitch";

export type SongRow = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  genre: string | null;
  artworkUrl: string | null;
  durationSec: number;
  clip: string;
  clipLengthSec: number | null;
  lookupStatus: LookupStatus;
  needsReview: boolean;
  active: boolean;
  /** How many songs in the catalog share this one's title and artist (1 = no copies). */
  copies: number;
};

export function Artwork({ url, size = 40 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted"
        aria-hidden="true"
      >
        ♪
      </div>
    );
  }
  // Apple's artwork CDN; a plain <img> keeps it simple (no image optimizer config needed).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md bg-surface-2 object-cover" style={{ width: size, height: size }} />;
}

function Status({ row }: { row: SongRow }) {
  const copies =
    row.copies > 1 ? (
      <span className="text-xs text-muted" title="Games treat copies with the same title and artist as one song">
        {row.copies} copies
      </span>
    ) : null;
  if (row.lookupStatus === "pending") return <span className="text-xs text-muted">Looking up…</span>;
  if (row.needsReview) return <span className="text-xs font-semibold text-danger">Needs a look</span>;
  if (row.lookupStatus === "error") return <span className="text-xs text-muted">Lookup failed</span>;
  return copies;
}

// ---------------------------------------------------------------------------
// Grouping: artist → album → song
// ---------------------------------------------------------------------------

type AlbumGroup = { key: string; name: string | null; year: number | null; artworkUrl: string | null; songs: SongRow[] };
type ArtistGroup = {
  key: string;
  name: string;
  sortKey: string;
  artworkUrl: string | null;
  albums: AlbumGroup[];
  songCount: number;
  offCount: number;
  reviewCount: number;
};

const squash = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** "The Killers" files under K, like a music library. */
function artistSortKey(name: string) {
  return squash(name).replace(/^the /, "");
}

export function groupByArtist(rows: SongRow[]): ArtistGroup[] {
  const artists = new Map<string, { name: string; albums: Map<string, SongRow[]> }>();
  for (const row of rows) {
    const aKey = squash(row.artist);
    let artist = artists.get(aKey);
    if (!artist) {
      artist = { name: row.artist.trim(), albums: new Map() };
      artists.set(aKey, artist);
    }
    const albumKey = row.album ? squash(row.album) : "";
    const list = artist.albums.get(albumKey) ?? [];
    list.push(row);
    artist.albums.set(albumKey, list);
  }

  const groups: ArtistGroup[] = [];
  for (const [key, artist] of artists) {
    const albums: AlbumGroup[] = [...artist.albums.entries()].map(([albumKey, songs]) => {
      const years = songs.map((s) => s.year).filter((y): y is number => y !== null);
      return {
        key: albumKey,
        name: albumKey ? songs[0].album!.trim() : null,
        year: years.length ? Math.min(...years) : null,
        artworkUrl: songs.find((s) => s.artworkUrl)?.artworkUrl ?? null,
        songs: [...songs].sort((a, b) => collator.compare(a.title, b.title)),
      };
    });
    // Albums oldest first; songs with no album last.
    albums.sort((a, b) => {
      if (!a.name !== !b.name) return a.name ? -1 : 1;
      if (a.year !== b.year) return a.year === null ? 1 : b.year === null ? -1 : a.year - b.year;
      return collator.compare(a.name ?? "", b.name ?? "");
    });
    const all = albums.flatMap((a) => a.songs);
    groups.push({
      key,
      name: artist.name,
      sortKey: artistSortKey(artist.name),
      artworkUrl: albums.find((a) => a.artworkUrl)?.artworkUrl ?? null,
      albums,
      songCount: all.length,
      offCount: all.filter((s) => !s.active).length,
      reviewCount: all.filter((s) => s.needsReview).length,
    });
  }
  return groups.sort((a, b) => collator.compare(a.sortKey, b.sortKey));
}

// ---------------------------------------------------------------------------
// The catalog browser
// ---------------------------------------------------------------------------

type View = "artist" | "recent";
type Show = "all" | "active" | "inactive" | "review" | "copies";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const segment = (selected: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition ${
    selected ? "bg-ink text-bg" : "text-muted hover:text-ink"
  }`;

// Decade and genre tags. "none" / "" stand for songs with no year / no genre.
type DecadeTag = number | "none";
const decadeTagOf = (r: SongRow): DecadeTag => (r.year === null ? "none" : decadeOf(r.year));
const genreTagOf = (r: SongRow): string => (r.genre ? filterKey(r.genre) : "");

function toggled<K>(set: Set<K>, key: K): Set<K> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** A tag to tap: ticked tags narrow the list; the count is how many songs it would show. */
function Tag({ on, count, onClick, children }: { on: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
        on
          ? "border-accent bg-accent/10 text-ink"
          : count === 0
            ? "border-line text-muted/50 hover:border-muted"
            : "border-line text-ink hover:border-muted"
      }`}
    >
      {children} <span className="font-normal text-muted">{count}</span>
    </button>
  );
}

export function SongTable({ rows }: { rows: SongRow[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("artist");
  const [show, setShow] = useState<Show>("all");
  const [decades, setDecades] = useState<Set<DecadeTag>>(new Set());
  const [genres, setGenres] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  // Search and "Show" first; then the tags: any ticked decade, and any ticked genre.
  const base = useMemo(
    () =>
      rows.filter(
        (r) =>
          (show === "all" ||
            (show === "active" && r.active) ||
            (show === "inactive" && !r.active) ||
            (show === "review" && r.needsReview) ||
            (show === "copies" && r.copies > 1)) &&
          (!q || `${r.title} ${r.artist} ${r.album ?? ""} ${r.genre ?? ""} ${r.year ?? ""}`.toLowerCase().includes(q)),
      ),
    [rows, q, show],
  );
  const decadeOk = (r: SongRow) => decades.size === 0 || decades.has(decadeTagOf(r));
  const genreOk = (r: SongRow) => genres.size === 0 || genres.has(genreTagOf(r));
  const shown = base.filter((r) => decadeOk(r) && genreOk(r));
  const groups = groupByArtist(shown);

  // Every decade and genre in the catalog gets a tag (so tags don't jump around);
  // each count follows the other filters: tick "Alternative" and the decades
  // count Alternative songs.
  const decadeTags = (() => {
    const all = [...new Set(rows.map(decadeTagOf))].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : a - b));
    const counts = new Map<DecadeTag, number>();
    for (const r of base) if (genreOk(r)) counts.set(decadeTagOf(r), (counts.get(decadeTagOf(r)) ?? 0) + 1);
    return all.map((key) => ({ key, label: key === "none" ? "No year" : `${key}s`, count: counts.get(key) ?? 0 }));
  })();
  const genreTags = (() => {
    const names = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const key = genreTagOf(r);
      const spellings = names.get(key) ?? new Map<string, number>();
      const label = r.genre?.trim() || "No genre";
      spellings.set(label, (spellings.get(label) ?? 0) + 1);
      names.set(key, spellings);
    }
    const counts = new Map<string, number>();
    for (const r of base) if (decadeOk(r)) counts.set(genreTagOf(r), (counts.get(genreTagOf(r)) ?? 0) + 1);
    return [...names.entries()]
      .map(([key, spellings]) => ({
        key,
        // The most common spelling names the tag.
        label: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
        total: [...spellings.values()].reduce((a, b) => a + b, 0),
        count: counts.get(key) ?? 0,
      }))
      .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.total - a.total || a.label.localeCompare(b.label)));
  })();
  const tagging = decades.size > 0 || genres.size > 0;

  // While searching or filtering, every matching artist is shown open.
  const filtering = Boolean(q) || show !== "all" || tagging;
  const isOpen = (key: string) => filtering || open.has(key);
  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const offTotal = rows.filter((r) => !r.active).length;
  const reviewTotal = rows.filter((r) => r.needsReview).length;
  const copiesTotal = rows.filter((r) => r.copies > 1).length;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, artist, album, genre or year"
          className="w-full max-w-sm rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
        />
        <div className="flex rounded-full bg-surface p-1" role="group" aria-label="View">
          <button type="button" className={segment(view === "artist")} aria-pressed={view === "artist"} onClick={() => setView("artist")}>
            By artist
          </button>
          <button type="button" className={segment(view === "recent")} aria-pressed={view === "recent"} onClick={() => setView("recent")}>
            Recently added
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Show
          <select
            value={show}
            onChange={(e) => setShow(e.target.value as Show)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink focus:border-accent focus:outline-none"
          >
            <option value="all">All songs</option>
            <option value="active">In games only</option>
            <option value="inactive">Left out of games ({offTotal})</option>
            <option value="review">Needs a look ({reviewTotal})</option>
            {copiesTotal > 0 && <option value="copies">Same song more than once ({copiesTotal})</option>}
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">Decades</span>
          {decadeTags.map((t) => (
            <Tag key={String(t.key)} on={decades.has(t.key)} count={t.count} onClick={() => setDecades((d) => toggled(d, t.key))}>
              {t.label}
            </Tag>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">Genres</span>
          {genreTags.map((t) => (
            <Tag key={t.key} on={genres.has(t.key)} count={t.count} onClick={() => setGenres((g) => toggled(g, t.key))}>
              {t.label}
            </Tag>
          ))}
        </div>
        {tagging && (
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span>Any ticked decade, and any ticked genre.</span>
            <button
              type="button"
              onClick={() => {
                setDecades(new Set());
                setGenres(new Set());
              }}
              className="font-semibold text-ink underline-offset-2 hover:underline"
            >
              Clear tags
            </button>
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>
          {view === "artist" ? `${plural(groups.length, "artist", "artists")} · ` : ""}
          {shown.length === rows.length ? plural(rows.length, "song", "songs") : `${shown.length} of ${plural(rows.length, "song", "songs")}`}
        </span>
        {view === "artist" && !filtering && groups.length > 0 && (
          <span className="flex gap-4">
            <button type="button" className="hover:text-ink" onClick={() => setOpen(new Set(groups.map((g) => g.key)))}>
              Expand all
            </button>
            <button type="button" className="hover:text-ink" onClick={() => setOpen(new Set())}>
              Collapse all
            </button>
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-line p-6 text-center text-muted">No songs match.</p>
      ) : view === "artist" ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {groups.map((g) => (
            <ArtistItem key={g.key} group={g} open={isOpen(g.key)} onToggle={() => toggle(g.key)} />
          ))}
        </ul>
      ) : (
        <RecentTable rows={shown} />
      )}
    </section>
  );
}

/** Switch · title · genre · length · clip · status + Edit (genre and clip hide on narrow screens). */
const SONG_GRID = "grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_auto] md:grid-cols-[2.5rem_minmax(0,1fr)_9rem_3.5rem_10rem_12rem]";

function ArtistItem({ group, open, onToggle }: { group: ArtistGroup; open: boolean; onToggle: () => void }) {
  const named = group.albums.filter((a) => a.name).length;
  const meta = [
    named ? plural(named, "album", "albums") : null,
    plural(group.songCount, "song", "songs"),
    group.offCount ? `${group.offCount} left out` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // An artist whose songs all lack an album doesn't need an album heading.
  const showAlbumHeadings = group.albums.length > 1 || Boolean(group.albums[0]?.name);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface/50"
      >
        <svg
          viewBox="0 0 12 12"
          className={`size-3 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Artwork url={group.artworkUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{group.name}</span>
          <span className="block truncate text-sm text-muted">{meta}</span>
        </span>
        {group.reviewCount > 0 && (
          <span className="text-xs font-semibold text-danger">{plural(group.reviewCount, "needs a look", "need a look")}</span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-4 bg-surface/30 px-4 pb-4 pt-1 sm:pl-10">
          {group.albums.map((album) => (
            <div key={album.key}>
              {showAlbumHeadings && (
                <div className="flex items-center gap-3 py-2">
                  <Artwork url={album.artworkUrl} size={32} />
                  <span className="font-semibold text-ink">{album.name ?? "No album"}</span>
                  <span className="text-sm text-muted">
                    {[album.year, plural(album.songs.length, "song", "songs")].filter(Boolean).join(" · ")}
                  </span>
                </div>
              )}
              {/* One fixed grid for every album, so columns line up down the whole artist. */}
              <ul className="divide-y divide-line/60 text-sm">
                {album.songs.map((r) => {
                  const dim = r.active ? "" : "opacity-50";
                  return (
                    <li key={r.id} className={`grid items-center gap-x-3 py-2 ${SONG_GRID}`}>
                      <ActiveSwitch id={r.id} active={r.active} title={r.title} />
                      <Link href={`/admin/catalog/${r.id}`} className={`truncate font-medium text-ink hover:underline ${dim}`}>
                        {r.title}
                      </Link>
                      <span className={`hidden truncate text-muted md:block ${dim}`}>{r.genre ?? "—"}</span>
                      <span className={`tabular-nums text-muted ${dim}`}>{formatTime(r.durationSec)}</span>
                      <span className={`hidden truncate text-muted md:block ${dim}`}>
                        {r.clip}
                        {r.clipLengthSec ? <span className="ml-1 text-xs">({r.clipLengthSec}s)</span> : null}
                      </span>
                      <span className="flex items-center justify-end gap-3">
                        <Status row={r} />
                        <Link
                          href={`/admin/catalog/${r.id}`}
                          className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line"
                        >
                          Edit
                        </Link>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** Newest uploads first: handy right after adding a batch of songs. */
function RecentTable({ rows }: { rows: SongRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="w-16 px-4 py-3 font-semibold">In games</th>
            <th className="px-4 py-3 font-semibold">Song</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Album</th>
            <th className="px-4 py-3 font-semibold">Year</th>
            <th className="px-4 py-3 font-semibold">Length</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Clip</th>
            <th className="px-4 py-3 font-semibold">
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const dim = r.active ? "" : "opacity-50";
            return (
              <tr key={r.id} className="align-middle hover:bg-surface/50">
                <td className="px-4 py-3">
                  <ActiveSwitch id={r.id} active={r.active} title={r.title} />
                </td>
                <td className={`px-4 py-3 ${dim}`}>
                  <Link href={`/admin/catalog/${r.id}`} className="flex items-center gap-3">
                    <Artwork url={r.artworkUrl} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{r.title}</span>
                      <span className="block truncate text-muted">{r.artist}</span>
                    </span>
                  </Link>
                </td>
                <td className={`hidden px-4 py-3 text-muted md:table-cell ${dim}`}>{r.album ?? "—"}</td>
                <td className={`px-4 py-3 text-muted ${dim}`}>{r.year ?? "—"}</td>
                <td className={`px-4 py-3 tabular-nums text-muted ${dim}`}>{formatTime(r.durationSec)}</td>
                <td className={`hidden px-4 py-3 text-muted md:table-cell ${dim}`}>
                  {r.clip}
                  {r.clipLengthSec ? <span className="ml-1 text-xs">({r.clipLengthSec}s)</span> : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-3">
                    <Status row={r} />
                    <Link
                      href={`/admin/catalog/${r.id}`}
                      className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line"
                    >
                      Edit
                    </Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
