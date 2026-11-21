import type { GameView } from "@/lib/game-view";
import { formatPoints } from "@/lib/rules";
import { ResultsCard } from "./parts";
import { Standings } from "./Standings";

/**
 * A game that's over: who won, the final standings and every song's results.
 * On the game page, and inside the past-games panel (`compact`).
 */
export function Final({ view, me, compact = false }: { view: GameView; me: string; compact?: boolean }) {
  // Anyone out of the game has no place (they're at the bottom, crossed out).
  const placed = view.standings.filter((s) => !s.out);
  const top = placed[0];
  const winners = placed.filter((s) => s.points === top?.points);
  return (
    <>
      <section>
        <h1 className={`${compact ? "text-2xl" : "text-3xl"} font-bold leading-tight`}>
          {view.status === "cancelled"
            ? "This game was ended early."
            : winners.length > 1
              ? `${winners.map((w) => w.name).join(" and ")} tie!`
              : `${top?.name} wins!`}
        </h1>
        {view.status === "finished" && top && (
          <p className={compact ? "mt-1 text-sm text-muted" : "mt-2 text-lg text-muted"}>
            {formatPoints(top.points)} points over {view.songCount} songs.
          </p>
        )}
      </section>
      <Standings gameId={view.id} me={me} standings={view.standings} songs={view.songs} title="Final standings" />
      {view.history.map((r) => (
        <ResultsCard
          key={r.position}
          results={r}
          // Pass the Aux: each song was one player's turn.
          title={view.mode === "aux" && r.picks[0] ? `Song ${r.position} · ${r.picks[0].name}` : `Song ${r.position}`}
        />
      ))}
    </>
  );
}
