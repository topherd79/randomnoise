"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTime } from "@/lib/clips";
import type { LookupStatus } from "@/db/schema";

export type SongRow = {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  genre: string | null;
  artworkUrl: string | null;
  durationSec: number;
  clip: string;
  clipLengthSec: number | null;
  lookupStatus: LookupStatus;
  needsReview: boolean;
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
  return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-md bg-surface-2 object-cover" style={{ width: size, height: size }} />;
}

function Status({ row }: { row: SongRow }) {
  if (row.lookupStatus === "pending") return <span className="text-xs text-muted">Looking up…</span>;
  if (row.needsReview) return <span className="text-xs font-semibold text-danger">Needs a look</span>;
  if (row.lookupStatus === "error") return <span className="text-xs text-muted">Lookup failed</span>;
  return null;
}

export function SongTable({ rows }: { rows: SongRow[] }) {
  const [query, setQuery] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyReview || r.needsReview) &&
        (!q || `${r.title} ${r.artist} ${r.genre ?? ""} ${r.year ?? ""}`.toLowerCase().includes(q)),
    );
  }, [rows, query, onlyReview]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, artist, genre or year"
          className="w-full max-w-sm rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlyReview}
            onChange={(e) => setOnlyReview(e.target.checked)}
            className="size-4 accent-[#d6ff3f]"
          />
          Only songs that need a look
        </label>
        <span className="text-sm text-muted">
          {shown.length === rows.length ? `${rows.length} songs` : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Song</th>
              <th className="px-4 py-3 font-semibold">Year</th>
              <th className="px-4 py-3 font-semibold">Genre</th>
              <th className="px-4 py-3 font-semibold">Length</th>
              <th className="px-4 py-3 font-semibold">Clip</th>
              <th className="px-4 py-3 font-semibold">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => (
              <tr key={r.id} className="align-middle hover:bg-surface/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/catalog/${r.id}`} className="flex items-center gap-3">
                    <Artwork url={r.artworkUrl} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{r.title}</span>
                      <span className="block truncate text-muted">{r.artist}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{r.year ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{r.genre ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums text-muted">{formatTime(r.durationSec)}</td>
                <td className="px-4 py-3 text-muted">
                  {r.clip}
                  {r.clipLengthSec ? <span className="ml-1 text-xs">({r.clipLengthSec}s)</span> : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Status row={r} />
                    <Link
                      href={`/admin/catalog/${r.id}`}
                      className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line"
                    >
                      Edit
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-6 text-center text-muted">No songs match.</p>}
      </div>
    </section>
  );
}
