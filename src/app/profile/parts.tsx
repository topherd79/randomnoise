import Link from "next/link";
import type { PastGame, Profile, ProfileCard } from "@/lib/profiles";
import { PanelLink } from "@/components/PanelNav";
import type { GroupStat, ScoredSong } from "@/lib/profile-stats";
import { companyText, ordinal } from "@/lib/profile-stats";
import { MODES } from "@/lib/modes";
import { formatPoints, formatSeconds } from "@/lib/rules";
import { Cover } from "../game/[id]/parts";

/** "Nov 14", with the year when it isn't this year. */
export function day(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "4.2 s" that never breaks between the number and the "s". */
export const secs = (ms: number) => formatSeconds(ms).replace(" ", " ");

export function Avatar({ name, size = 44, accent = false }: { name: string; size?: number; accent?: boolean }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${
        accent ? "bg-accent text-accent-ink" : "border border-line bg-surface-2 text-ink"
      }`}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="-ml-1 flex min-h-11 items-center gap-1.5 font-semibold text-muted">
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </Link>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">{children}</h2>;
}

/** "12 games · 5 wins" */
export function gamesAndWins(p: Pick<Profile, "games" | "wins">): string {
  return `${p.games} ${p.games === 1 ? "game" : "games"} · ${p.wins} ${p.wins === 1 ? "win" : "wins"}`;
}

export function percentRight(p: Pick<Profile, "answered" | "right">): string | null {
  return p.answered ? `${Math.round((100 * p.right) / p.answered)}%` : null;
}

/** A past game's two lines: "Nov 14 · 3 songs", and "9 songs · with Dave and Sarah". */
function pastGameLines(game: PastGame) {
  return {
    title: `${day(game.date)} · ${MODES[game.mode].name}`,
    detail: game.out
      ? `Left after ${game.played} of ${game.songCount} songs`
      : game.status === "cancelled"
        ? `Ended early after ${game.completed} of ${game.songCount} songs`
        : `${game.songCount} songs · ${companyText(game.others)}`,
  };
}

/**
 * One game in a past-games list: your place, the game, your points and who won.
 * In the past-games panel its results open in the panel.
 */
export function PastGameRow({ game }: { game: PastGame }) {
  const ended = game.status === "cancelled";
  // Played alone (nobody else, or everyone else out): never a win.
  const solo = !game.out && game.playersIn === 1;
  const badge = game.out ? "Out" : ended ? "End" : solo ? "Solo" : ordinal(game.place);
  const { title, detail } = pastGameLines(game);
  return (
    <li>
      <PanelLink
        href={`/game/${game.id}`}
        page={{ kind: "game", id: game.id, title, subtitle: detail }}
        className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2"
      >
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full font-extrabold ${
            game.won
              ? "bg-accent text-[13px] text-accent-ink"
              : ended || solo || game.out
                ? "bg-surface-2 text-[11px] text-muted"
                : "bg-surface-2 text-[13px]"
          }`}
        >
          {badge}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{title}</span>
          <span className="truncate text-sm text-muted">{detail}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-bold tabular-nums">{formatPoints(game.points)}</span>
          {game.result && <span className="text-[13px] text-muted">{game.result}</span>}
        </span>
      </PanelLink>
    </li>
  );
}

export function PastGamesList({ games }: { games: PastGame[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
      {games.map((g) => (
        <PastGameRow key={g.id} game={g} />
      ))}
    </ul>
  );
}

/** The top three right answers. `compact` is the one-line-each version on a friend's profile. */
export function BestGuesses({ guesses, compact = false }: { guesses: ScoredSong[]; compact?: boolean }) {
  if (guesses.length === 0) {
    return <p className="rounded-2xl bg-surface px-4 py-4 text-sm text-muted">No right answers in a finished game yet.</p>;
  }
  if (compact) {
    return (
      <ol className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {guesses.map((g, i) => (
          <li key={i} className="flex items-center gap-2.5 px-3.5 py-3">
            <span className={`w-5 text-center font-extrabold ${i === 0 ? "text-accent" : "text-muted"}`}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {g.title} <span className="font-normal text-muted">– {g.artist}</span>
              </span>
              <span className="block text-xs text-muted">
                {secs(g.elapsedMs)} · {day(g.answeredAt)}
              </span>
            </span>
            <span className="font-extrabold tabular-nums text-accent">+{formatPoints(g.points)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="flex flex-col gap-2.5">
      {guesses.map((g, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
              i === 0 ? "bg-accent text-accent-ink" : "bg-surface-2"
            }`}
          >
            {i + 1}
          </span>
          <Cover url={g.artworkUrl} size={48} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-bold">{g.title}</span>
            <span className="truncate text-sm text-muted">{g.artist}</span>
            <span className="mt-0.5 text-[13px] text-muted">
              {secs(g.elapsedMs)} · {day(g.answeredAt)}
            </span>
          </span>
          <span className="text-xl font-extrabold tabular-nums text-accent">+{formatPoints(g.points)}</span>
        </li>
      ))}
    </ol>
  );
}

type Kind = "genre" | "decade";

/** A best or worst genre (or decade) card; an empty one says what it's waiting for. */
export function GroupCard({
  stat,
  which,
  kind,
  label,
  compact = false,
}: {
  stat: GroupStat | null;
  which: "best" | "worst";
  kind: Kind;
  /** Overrides the small heading ("BEST", or "BEST GENRE" when compact). */
  label?: string;
  compact?: boolean;
}) {
  const best = which === "best";
  const heading = label ?? (best ? "Best" : "Worst");
  const waiting = best
    ? `Needs 5 songs from one ${kind}`
    : `Needs 5 songs from another ${kind}`;
  if (compact) {
    return (
      <div className="flex flex-col gap-0.5 rounded-xl bg-surface px-3.5 py-3">
        <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${best ? "text-accent" : "text-danger"}`}>{heading}</span>
        <span className="truncate font-bold">{stat ? stat.name : "—"}</span>
        <span className="text-xs text-muted">
          {stat ? `${formatPoints(stat.average)} a song · ${stat.songs} songs` : waiting}
        </span>
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col gap-1 rounded-2xl border bg-surface p-4 ${
        stat ? (best ? "border-accent/25" : "border-danger/25") : "border-transparent"
      }`}
    >
      <span className={`text-xs font-bold uppercase tracking-[0.14em] ${best ? "text-accent" : "text-danger"}`}>{heading}</span>
      {stat ? (
        <>
          <span className="truncate text-xl font-bold">{stat.name}</span>
          <span className="text-[17px] font-bold tabular-nums">{formatPoints(stat.average)} a song</span>
          <span className="text-[13px] text-muted">
            {stat.songs} songs · {formatPoints(stat.total)} total
          </span>
        </>
      ) : (
        <>
          <span className="text-xl font-bold text-muted">—</span>
          <span className="text-[13px] text-muted">{waiting}</span>
        </>
      )}
    </div>
  );
}

/**
 * The short profile: name, games and wins, best guesses, best and worst genre
 * and decade. A friend's profile page, and any profile opened in a side panel
 * (`compact`), yours included.
 */
export function ProfileSummary({ p, compact = false }: { p: ProfileCard; compact?: boolean }) {
  const right = percentRight(p);
  const line = [gamesAndWins(p), right && `${right} right`, p.averageMs !== null && `${secs(p.averageMs)} average`].filter(Boolean);
  return (
    <>
      <section className="flex items-center gap-3">
        <Avatar name={p.name} size={compact ? 48 : 52} />
        <div className="min-w-0">
          <h1 className={`truncate font-bold leading-tight ${compact ? "text-[22px]" : "text-[26px]"}`}>{p.name}</h1>
          <p className={compact ? "text-[13px] text-muted" : "text-sm text-muted"}>{line.join(" · ")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Best guesses</SectionTitle>
        <BestGuesses guesses={p.bestGuesses} compact />
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Best and worst</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <GroupCard stat={p.genres.best} which="best" kind="genre" label="Best genre" compact />
          <GroupCard stat={p.genres.worst} which="worst" kind="genre" label="Worst genre" compact />
          <GroupCard stat={p.decades.best} which="best" kind="decade" label="Best decade" compact />
          <GroupCard stat={p.decades.worst} which="worst" kind="decade" label="Worst decade" compact />
        </div>
      </section>

      <p className="text-xs leading-relaxed text-muted">Only games that are over count.</p>
    </>
  );
}
