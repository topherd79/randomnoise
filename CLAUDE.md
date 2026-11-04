@AGENTS.md

# Random Noise

A private, turn-based song-guessing game for a small group of friends (1–5 players per game),
played in mobile Safari on iPhones. Hosted on Railway, email through Resend, domain randomnoise.ai.

The full product decisions (and the reasoning behind them) live in the decision log:
https://claude.ai/artifact/H477Nc2h2RAwzVDDH8VHva — read it before changing game rules.

## The game in one paragraph

The admin uploads songs (full mp3s) into a running catalog. A game draws 5/10/15/20/25 unplayed songs
at random (only songs switched on in the catalog); the admin can choose "Include songs from earlier games",
which tops up with songs played longest ago (`songPool` in `createGame`). For each song, a player taps Play: a short clip and the answer clock start together, four
"Title – Artist" choices (1 right, 3 random other catalog songs) reveal letter by letter and finish
together, and a faster correct answer scores more (1,000 sliding to 100; a wrong answer loses a third
of what a right one would have earned, so guessing is worth zero on average). Players
answer on their own time; the group moves to the next song only when everyone has answered, then
sees everyone's picks and the standings. The admin also plays, so admin screens never show the
songs of a game in progress.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4). `cacheComponents` is deliberately **off**: nearly
  every page depends on the logged-in user, so the classic dynamic model is simpler.
- Postgres via Drizzle ORM (`src/db/schema.ts`), node-postgres driver.
- Resend for email (`src/lib/email.ts`).
- Dockerfile build on Railway (includes ffmpeg for clip cutting). See "Hosting" below.

## Hosting

- Railway project **randomnoise** has two services: `randomnoise` (this app) and `Postgres`. Every
  push to `main` deploys automatically.
- Deploy settings are set on the service in Railway, not in the repo: Dockerfile build, health check
  `/api/health` (120s timeout), restart on failure (5 retries). Railway no longer reads `railway.json`
  for new services, so don't add one back. Its replacement, `.railway/railway.ts`, describes the
  whole project and deletes anything it doesn't list, so adopting it is a deliberate decision.
- Service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_URL`, `ADMIN_EMAIL`,
  `EMAIL_FROM`, `RESEND_API_KEY`.
- Song files and clips live on a Railway volume attached to the app service at `/data` (Railway sets
  `RAILWAY_VOLUME_MOUNT_PATH`). All file paths go through `src/lib/storage.ts`; audio work (tags,
  conversion, sound waves, clip cutting) is ffmpeg/ffprobe in `src/lib/audio.ts`.
- DNS is on Cloudflare. The apex CNAME to Railway must stay **DNS only (grey cloud)**. If it's
  proxied, Railway can't verify the domain and serves its "Not Found" page instead of the app.

## Conventions

- **Auth:** magic links only. `/auth/[token]` shows a "Log in" button; only the button (a server
  action) uses up the token, so link scanners and iMessage previews can't burn it. Tokens don't expire
  with time. Sessions last a year. Helpers are in `src/lib/auth.ts`.
- **Admin:** the user whose email equals `ADMIN_EMAIL`. Call `requireAdmin()` at the top of every
  admin page **and every admin server action** (server actions are public endpoints).
- **Schema changes:** edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in
  `drizzle/`. Migrations run automatically on start (`npm start` runs `scripts/migrate.mjs` first).
- **Email in development:** with no `RESEND_API_KEY`, emails (and their links) print to the server
  console. Note: the Claude cloud environment may have a real `RESEND_API_KEY` in its environment —
  unset it (`env -u RESEND_API_KEY …`) when running the app for tests so no real email goes out.
- **Song details lookup:** Apple's free song search (`src/lib/lookup.ts`), about 20 searches a
  minute, so the catalog page runs lookups one at a time. song.link's free API is gone; Spotify links
  are exact only if `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are set, otherwise a search link.
- **Audio responses** must support HTTP Range (`serveFile` in `src/lib/storage.ts`): iPhone Safari won't
  play audio without it.
- **Game rules and numbers** (reveal time, cutoff, points, guessing penalty) are all in
  `src/lib/rules.ts`. The server keeps the clock (`answers.started_at` is set when the clip actually
  starts playing) and scores every answer; the phone is never told which choice is right.
- **Switched-off songs** (`songs.active = false`) stay in the catalog but new games leave them out
  entirely: never drawn, never a wrong answer (`createGame` in `src/lib/games.ts`). Games already
  created are unaffected. Clip lengths are `CLIP_LENGTHS` in `src/lib/clips.ts` (5/10/20/30 s).
- **Admin screens never show the songs of a game in progress** (the admin plays too): see
  `src/lib/admin-games.ts`. Clips have random file names, are only served to players in that game
  and never ahead of the current song; the full song unlocks only after a player answers.
- Phone screens: max width `max-w-md`, respect safe areas, inputs at 16px+ so iOS doesn't zoom.
  Admin screens are laid out for a desktop browser.

## Checks

```bash
npm run typecheck && npm run lint && npm run build
```
