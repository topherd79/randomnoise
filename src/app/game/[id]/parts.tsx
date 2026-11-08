import type { Pick, ResultsView, SongInfo } from "@/lib/game-view";
import { formatPoints, formatSeconds } from "@/lib/rules";

export function Cover({ url, size = 72 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-xl bg-surface-2 text-2xl text-muted"
        aria-hidden="true"
      >
        ♪
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-xl bg-surface-2 object-cover" />;
}

/** The song, the full track and listening links (shown once you've answered). */
export function SongCard({ song, withAudio = true }: { song: SongInfo; withAudio?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-center gap-4">
        <Cover url={song.artworkUrl} />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{song.title}</p>
          <p className="text-muted">{song.artist}</p>
          {(song.album || song.year) && (
            <p className="mt-0.5 truncate text-sm text-muted">{[song.album, song.year].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      </div>
      {/* No player once the song has been deleted from the catalog; the links still work. */}
      {withAudio && song.fullUrl && <audio controls preload="none" src={song.fullUrl} className="mt-4 w-full" />}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-semibold">
        <a href={song.spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full bg-surface-2 py-2.5 text-center text-ink">
          Spotify
        </a>
        <a href={song.appleMusicUrl} target="_blank" rel="noreferrer" className="rounded-full bg-surface-2 py-2.5 text-center text-ink">
          Apple Music
        </a>
      </div>
    </div>
  );
}

function pointsText(points: number | null) {
  if (points === null) return "—";
  return points > 0 ? `+${formatPoints(points)}` : formatPoints(points);
}

/** Everyone's picks for one song; players who haven't answered it yet show as "not played yet". */
export function PicksList({ picks }: { picks: Pick[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
      {picks.map((p) => (
        <li key={p.userId} className="flex items-center gap-3 px-4 py-3">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              p.correct ? "bg-accent text-accent-ink" : p.label ? "bg-danger/20 text-danger" : "bg-surface-2 text-muted"
            }`}
            aria-label={p.correct ? "right" : p.label ? "wrong" : p.pending ? "not played yet" : "no answer"}
          >
            {p.correct ? "✓" : p.label ? "✕" : "–"}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${p.pending ? "text-muted" : ""}`}>{p.name}</span>
            <span className="block truncate text-sm text-muted">
              {p.pending ? "Not played yet" : (p.label ?? "No answer")}
              {p.elapsedMs !== null && ` · ${formatSeconds(p.elapsedMs)}`}
            </span>
          </span>
          {!p.pending && (
            <span className={`font-bold tabular-nums ${p.points && p.points > 0 ? "text-accent" : p.points && p.points < 0 ? "text-danger" : "text-muted"}`}>
              {pointsText(p.points)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One song with everyone's picks. */
export function ResultsCard({ results, title }: { results: ResultsView; title?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
        {title ?? `Song ${results.position} results`}
      </h2>
      <SongCard song={results.song} />
      <PicksList picks={results.picks} />
    </section>
  );
}
