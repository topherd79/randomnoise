import "server-only";
import { Resend } from "resend";
import { adminEmail, emailFrom } from "./env";
import type { GameResults } from "./game-view";
import type { GameMode } from "./modes";
import { formatPoints, formatSeconds } from "./rules";

type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Send an email through Resend. Without RESEND_API_KEY (local development)
 * the email is printed to the server console instead, links included.
 */
export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(
      `\n[email] (RESEND_API_KEY not set, not sending)\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`,
    );
    return;
  }

  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: emailFrom(),
    to: email.to,
    replyTo: adminEmail(),
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (error) throw new Error(`Resend error: ${error.name}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * One simple layout for every game email: heading, a line or two, one big
 * button, and optionally a longer section under it (the game-over results).
 */
function layout(opts: {
  heading: string;
  lines: string[];
  buttonText: string;
  url: string;
  extra?: { html: string; text: string };
}) {
  const lines = opts.lines.map(
    (l) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#3a3a44;">${escapeHtml(l)}</p>`,
  );
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f6;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="font-size:13px;font-weight:800;letter-spacing:0.18em;color:#0d0d12;margin-bottom:24px;">RANDOM NOISE</div>
    <div style="background:#ffffff;border-radius:16px;padding:28px 24px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0d0d12;">${escapeHtml(opts.heading)}</h1>
      ${lines.join("\n      ")}
      <a href="${escapeHtml(opts.url)}" style="display:inline-block;margin-top:8px;background:#0d0d12;color:#d6ff3f;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:999px;">${escapeHtml(opts.buttonText)}</a>
      ${opts.extra?.html ?? ""}
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8a8a96;">This button works once. If it's already been used, ask for a new link on the login page.</p>
    </div>
  </div>
</body></html>`;
  const text = `${opts.heading}\n\n${opts.lines.join("\n\n")}\n\n${opts.buttonText}: ${opts.url}\n\n${opts.extra ? `${opts.extra.text}\n\n` : ""}This link works once. If it's already been used, ask for a new link on the login page.`;
  return { html, text };
}

export function loginEmail(name: string, url: string) {
  return {
    subject: "Your Random Noise login link",
    ...layout({
      heading: `Hi ${name}, here's your login link`,
      lines: ["Tap the button, then tap “Log in” on the page it opens."],
      buttonText: "Open Random Noise",
      url,
    }),
  };
}

export function inviteEmail(name: string, url: string) {
  return {
    subject: "You're in: Random Noise",
    ...layout({
      heading: `${name}, you've been added to Random Noise`,
      lines: [
        "It's a song-guessing game for our group. You hear a short clip, the answers reveal letter by letter, and the faster you pick the right one, the more points you get.",
        "Everyone plays on their own time. You'll get an email when a game starts.",
      ],
      buttonText: "Log in",
      url,
    }),
  };
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function gameOnEmail(name: string, url: string, game: { songCount: number; mode: GameMode; others: string[] }) {
  const withWho = game.others.length ? ` with ${names(game.others)}` : "";
  const n = game.songCount;
  const how =
    game.mode === "three"
      ? {
          subject: `Game on: ${n} songs, three at a time`,
          line: `${n} songs${withWho}, three at a time. Play them whenever you like; the next three open once everyone has played the first three.`,
          waiting: "Songs 1 to 3 are waiting.",
        }
      : game.mode === "all"
        ? {
            subject: `Game on: ${n} songs, all at once`,
            line: `${n} songs${withWho}, all open now. Play them at your own pace; the final results come in once everyone has played every song.`,
            waiting: `All ${n} songs are waiting.`,
          }
        : {
            subject: `Game on: ${n} songs`,
            line: `${n} songs${withWho}. Play each one whenever you like; the next song opens once everyone has answered.`,
            waiting: "Song 1 is waiting.",
          };
  return {
    subject: how.subject,
    ...layout({
      heading: `${name}, a new game is on`,
      lines: [how.line, how.waiting],
      buttonText: "Play song 1",
      url,
    }),
  };
}

/** `left`: how many songs in the open round they still have to play, starting with song `position`. */
export function nudgeEmail(name: string, url: string, fromName: string, to: { position: number; left: number }) {
  return {
    subject: `${fromName} nudged you`,
    ...layout({
      heading: `${name}, everyone's waiting on you`,
      lines: [
        to.left > 1
          ? `${fromName} nudged you: the game moves on once you've played ${to.left} more songs, starting with song ${to.position}.`
          : `${fromName} nudged you: song ${to.position} moves the game on as soon as you answer it.`,
      ],
      buttonText: `Play song ${to.position}`,
      url,
    }),
  };
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const signed = (p: number) => (p > 0 ? `+${formatPoints(p)}` : formatPoints(p));
const C = { ink: "#0d0d12", body: "#3a3a44", muted: "#8a8a96", line: "#ececf0", right: "#2e8a35", wrong: "#cc3344" };

/** One song's picks, best score first (no answer last; ties by name). */
const byScore = <T extends { name: string; points: number | null; label: string | null }>(picks: T[]): T[] =>
  [...picks].sort(
    (a, b) =>
      (b.label === null ? -Infinity : (b.points ?? 0)) - (a.label === null ? -Infinity : (a.points ?? 0)) ||
      a.name.localeCompare(b.name),
  );

/** Final standings plus every song with everyone's pick, as email-safe HTML and plain text. */
function resultsSection(results: GameResults) {
  const th = `style="padding:6px 0;font-size:12px;font-weight:600;color:${C.muted};text-align:left;"`;
  const standingsRows = results.standings
    .map(
      (s, i) =>
        `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid ${C.line};color:${C.muted};width:20px;">${i + 1}</td>` +
        `<td style="padding:8px 0;border-top:1px solid ${C.line};font-weight:700;color:${C.ink};">${escapeHtml(s.name)}</td>` +
        `<td style="padding:8px 0;border-top:1px solid ${C.line};color:${C.muted};font-size:14px;">${s.correct} right</td>` +
        `<td style="padding:8px 0;border-top:1px solid ${C.line};font-weight:700;color:${C.ink};text-align:right;">${formatPoints(s.points)}</td></tr>`,
    )
    .join("");

  const songBlocks = results.songs
    .map((song) => {
      const art = song.artworkUrl
        ? `<img src="${escapeHtml(song.artworkUrl)}" width="44" height="44" alt="" style="display:block;border-radius:6px;">`
        : `<div style="width:44px;height:44px;border-radius:6px;background:${C.line};text-align:center;line-height:44px;color:${C.muted};">&#9834;</div>`;
      const meta = [song.album, song.year].filter(Boolean).join(" · ");
      const picks = byScore(song.picks)
        .map((p) => {
          if (p.label === null) {
            return `<tr><td style="padding:5px 0;width:22px;color:${C.muted};">&ndash;</td><td style="padding:5px 0;color:${C.body};">${escapeHtml(p.name)} <span style="color:${C.muted};">&middot; no answer</span></td><td></td></tr>`;
          }
          const pts = p.points ?? 0;
          const mark = p.correct
            ? `<span style="color:${C.right};font-weight:700;">&#10003;</span>`
            : `<span style="color:${C.wrong};font-weight:700;">&#10007;</span>`;
          const detail = [p.elapsedMs !== null ? formatSeconds(p.elapsedMs) : null, p.correct ? null : `picked ${escapeHtml(p.label)}`]
            .filter(Boolean)
            .join(" &middot; ");
          return (
            `<tr><td style="padding:5px 0;width:22px;vertical-align:top;">${mark}</td>` +
            `<td style="padding:5px 0;color:${C.body};vertical-align:top;">${escapeHtml(p.name)}<br><span style="font-size:13px;color:${C.muted};">${detail}</span></td>` +
            `<td style="padding:5px 0;text-align:right;vertical-align:top;font-weight:700;color:${pts > 0 ? C.right : pts < 0 ? C.wrong : C.muted};white-space:nowrap;">${signed(pts)}</td></tr>`
          );
        })
        .join("");
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid ${C.line};padding-top:16px;">` +
        `<tr><td style="width:44px;vertical-align:top;padding-top:16px;">${art}</td>` +
        `<td style="padding:16px 0 0 12px;vertical-align:top;">` +
        `<div style="font-size:12px;color:${C.muted};">Song ${song.position}</div>` +
        `<div style="font-weight:700;color:${C.ink};">${escapeHtml(song.title)}</div>` +
        `<div style="font-size:14px;color:${C.body};">${escapeHtml(song.artist)}${meta ? ` <span style="color:${C.muted};">&middot; ${escapeHtml(meta)}</span>` : ""}</div>` +
        `<div style="font-size:13px;margin-top:3px;"><a href="${escapeHtml(song.spotifyUrl)}" style="color:${C.muted};">Spotify</a> &middot; <a href="${escapeHtml(song.appleMusicUrl)}" style="color:${C.muted};">Apple Music</a></div>` +
        `</td></tr></table>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:15px;">${picks}</table>`
      );
    })
    .join("");

  const html =
    `<h2 style="margin:32px 0 8px;font-size:17px;color:${C.ink};">Final standings</h2>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;"><tr><th ${th}>#</th><th ${th}>Player</th><th ${th}>Right</th><th style="padding:6px 0;font-size:12px;font-weight:600;color:${C.muted};text-align:right;">Points</th></tr>${standingsRows}</table>` +
    `<h2 style="margin:32px 0 0;font-size:17px;color:${C.ink};">Song by song</h2>` +
    songBlocks;

  const text = [
    "FINAL STANDINGS",
    ...results.standings.map((s, i) => `${i + 1}. ${s.name}: ${formatPoints(s.points)} points (${s.correct} right)`),
    "",
    "SONG BY SONG",
    ...results.songs.flatMap((song) => [
      "",
      `Song ${song.position}: ${song.title} – ${song.artist}`,
      ...byScore(song.picks).map((p) =>
        p.label === null
          ? `  – ${p.name}: no answer`
          : `  ${p.correct ? "✓" : "✗"} ${p.name}: ${signed(p.points ?? 0)}` +
            `${p.elapsedMs !== null ? ` in ${formatSeconds(p.elapsedMs)}` : ""}${p.correct ? "" : ` (picked ${p.label})`}`,
      ),
    ]),
  ].join("\n");

  return { html, text };
}

/** The one email after the last song: who won, final standings and every song's results. */
export function gameOverEmail(name: string, userId: string, url: string, results: GameResults) {
  const standings = results.standings;
  const winner = standings[0];
  const tied = standings.filter((s) => s.points === winner?.points);
  const headline = !winner
    ? "Game over"
    : tied.length > 1
      ? `Game over: ${names(tied.map((t) => t.name))} tie`
      : `Game over: ${winner.name} wins`;
  const rank = standings.findIndex((s) => s.userId === userId);
  const me = standings[rank];
  const lines = me
    ? [
        rank === 0 && tied.length === 1
          ? `You won with ${formatPoints(me.points)} points, ${name}. Nice ears.`
          : `You finished ${ordinal(rank + 1)} with ${formatPoints(me.points)} points, ${name}.`,
        `Here's how everyone did on all ${results.songs.length} songs, with links to add them to your playlists.`,
      ]
    : [`Thanks for playing, ${name}.`];
  return {
    subject: headline,
    ...layout({
      heading: headline,
      lines,
      buttonText: "See it in the game",
      url,
      extra: resultsSection(results),
    }),
  };
}
