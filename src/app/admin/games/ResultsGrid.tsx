import type { GameResults } from "@/lib/game-view";
import { formatPoints, formatSeconds } from "@/lib/rules";

function Cover({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted" aria-hidden="true">
        ♪
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-md bg-surface-2 object-cover" />;
}

/**
 * Song-by-song results of a finished game: songs down the side, one column per
 * player (in finishing order), each cell showing right/wrong, points and time,
 * plus the pick when it was wrong. Only for games that are over.
 */
export function ResultsGrid({ results }: { results: GameResults }) {
  const players = results.standings;
  if (results.songs.length === 0) {
    return <p className="text-sm text-muted">No songs were finished in this game.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">Song</th>
            {players.map((p, i) => (
              <th key={p.userId} className="px-3 py-3 font-semibold">
                <span className="block normal-case tracking-normal text-sm text-ink">
                  {i + 1}. {p.name}
                </span>
                <span className="block normal-case tracking-normal">
                  {formatPoints(p.points)} pts · {p.correct} right
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {results.songs.map((s) => (
            <tr key={s.position} className="align-top">
              <td className="px-4 py-3">
                <span className="flex items-center gap-3">
                  <span className="w-5 text-right text-xs tabular-nums text-muted">{s.position}</span>
                  <Cover url={s.artworkUrl} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{s.title}</span>
                    <span className="block truncate text-muted">
                      {s.artist}
                      {s.year ? ` · ${s.year}` : ""}
                    </span>
                  </span>
                </span>
              </td>
              {players.map((p) => {
                const pick = s.picks.find((x) => x.userId === p.userId);
                if (!pick || pick.label === null) {
                  return (
                    <td key={p.userId} className="px-3 py-3 text-muted">
                      No answer
                    </td>
                  );
                }
                const pts = pick.points ?? 0;
                return (
                  <td key={p.userId} className="px-3 py-3">
                    <span className="flex items-baseline gap-1.5">
                      <span className={pick.correct ? "text-accent" : "text-danger"} aria-label={pick.correct ? "right" : "wrong"}>
                        {pick.correct ? "✓" : "✕"}
                      </span>
                      <span className={`font-bold tabular-nums ${pts > 0 ? "text-accent" : pts < 0 ? "text-danger" : "text-muted"}`}>
                        {pts > 0 ? `+${formatPoints(pts)}` : formatPoints(pts)}
                      </span>
                      {pick.elapsedMs !== null && <span className="text-xs text-muted">{formatSeconds(pick.elapsedMs)}</span>}
                    </span>
                    {!pick.correct && (
                      <span className="mt-0.5 block max-w-[12rem] truncate text-xs text-muted" title={pick.label}>
                        Picked {pick.label}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
