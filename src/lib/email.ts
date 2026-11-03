import "server-only";
import { Resend } from "resend";
import { adminEmail, emailFrom } from "./env";

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

/** One simple layout for every game email: heading, a line or two, one big button. */
function layout(opts: { heading: string; lines: string[]; buttonText: string; url: string }) {
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
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#8a8a96;">This button works once. If it's already been used, ask for a new link on the login page.</p>
    </div>
  </div>
</body></html>`;
  const text = `${opts.heading}\n\n${opts.lines.join("\n\n")}\n\n${opts.buttonText}: ${opts.url}\n\nThis link works once. If it's already been used, ask for a new link on the login page.`;
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

export function gameOnEmail(name: string, url: string, game: { songCount: number; others: string[] }) {
  const withWho = game.others.length ? ` with ${names(game.others)}` : "";
  return {
    subject: `Game on: ${game.songCount} songs`,
    ...layout({
      heading: `${name}, a new game is on`,
      lines: [
        `${game.songCount} songs${withWho}. Play each one whenever you like; the next song opens once everyone has answered.`,
        "Song 1 is waiting.",
      ],
      buttonText: "Play song 1",
      url,
    }),
  };
}

export function roundDoneEmail(name: string, url: string, round: { position: number; total: number }) {
  return {
    subject: `Song ${round.position} results are in`,
    ...layout({
      heading: `Everyone has answered song ${round.position}`,
      lines: [`${name}, see who got it and how fast, then play song ${round.position + 1} of ${round.total}.`],
      buttonText: "See the results",
      url,
    }),
  };
}

export function nudgeEmail(name: string, url: string, fromName: string, position: number) {
  return {
    subject: `${fromName} nudged you`,
    ...layout({
      heading: `${name}, everyone's waiting on you`,
      lines: [`${fromName} nudged you: song ${position} opens up the results as soon as you answer it.`],
      buttonText: `Play song ${position}`,
      url,
    }),
  };
}

export function gameOverEmail(name: string, url: string, standings: { name: string; points: number }[]) {
  const winner = standings[0];
  const tied = standings.filter((s) => s.points === winner?.points);
  const headline = !winner
    ? "Game over"
    : tied.length > 1
      ? `Game over: ${names(tied.map((t) => t.name))} tie`
      : `Game over: ${winner.name} wins`;
  return {
    subject: headline,
    ...layout({
      heading: headline,
      lines: [
        ...standings.map((s, i) => `${i + 1}. ${s.name}: ${s.points.toLocaleString("en-US")} points`),
        `Thanks for playing, ${name}.`,
      ],
      buttonText: "See the final results",
      url,
    }),
  };
}
