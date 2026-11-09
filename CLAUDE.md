@AGENTS.md

# Random Noise

A private, turn-based song-guessing game for a small group of friends (1–5 players per game),
played in mobile Safari on iPhones. Hosted on Railway, email through Resend, domain randomnoise.ai.

The full product decisions (and the reasoning behind them) live in the decision log:
https://claude.ai/artifact/H477Nc2h2RAwzVDDH8VHva — read it before changing game rules.

## The game in one paragraph

The admin uploads songs (full mp3s) into a running catalog. A game draws its songs at random from
unplayed songs (only songs switched on in the catalog); the admin can choose "Include songs from earlier games",
which tops up with songs played longest ago (`songPool` in `createGame`). Optional filters (decades, genres,
artists; `src/lib/song-filters.ts`) narrow the draw: any option within a filter, all filters together;
wrong answers then come from the filtered set when it has enough songs. For each song, a player taps Play: a short clip and the answer clock start together, four
"Title – Artist" choices (1 right, 3 random other catalog songs) reveal letter by letter and finish
together, and a faster correct answer scores more (1,000 sliding to 100; a wrong answer loses a third
of what a right one would have earned, so guessing is worth zero on average). Players
answer on their own time. Songs open in rounds, by game mode (`src/lib/modes.ts`): **The OG** one
song at a time (5–25 songs), **3 songs** three at a time (6/9/15/18 songs), **All songs** every song
open from the start (5–25 songs). The next round opens only when everyone has answered every song in
this one. Once you've answered a song you see everyone's picks for it so far; standings count only
songs everyone has answered, and tapping a name in them shows that player's song-by-song history
(only songs you've answered). The admin also plays, so admin screens never show the songs of a game
in progress.

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
  minute, so the catalog page runs lookups one at a time; a miss is retried with the title alone
  after a pause, and "Try again" on the catalog page re-queues songs that weren't found. Apple's
  free search misses some songs entirely; then a Spotify match (when the keys are set) supplies
  the artwork, album and year, and the song counts as found. song.link's free API is gone; Spotify links
  are exact only if `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` are set, otherwise a search link.
  Songs looked up before the keys were set get exact links from the catalog page's "Find exact
  Spotify links" (`fillSpotifyLinkFor` in `src/lib/catalog.ts`, which also fills past games' snapshots).
- **Audio responses** must support HTTP Range (`serveFile` in `src/lib/storage.ts`): iPhone Safari won't
  play audio without it.
- **Game rules and numbers** (reveal time, cutoff, points, guessing penalty) are all in
  `src/lib/rules.ts`; game modes and their lengths in `src/lib/modes.ts`. The server keeps the clock (`answers.started_at` is set when the clip actually
  starts playing) and scores every answer; the phone is never told which choice is right.
- **Copies of a song** (same title and artist after `songKey()` in `src/lib/normalize.ts`, which
  ignores "(Remastered)", "feat. X" and the like) count as one song: a game draws at most one copy,
  and a copy of a played song counts as played (`usedSongs()` in `src/lib/catalog-queries.ts`). The
  catalog's "Show: Same song more than once" lists them. Answer choices show `cleanTitle()`, which
  hides release labels ("(2015 Remaster)", "(Album Version)") but keeps "(Live …)", "(Acoustic)".
- **Genres** go through `canonicalGenre()` (`src/lib/genres.ts`) on upload, lookup and edit, so
  French-tagged files ("Alternatif et Indé") don't split a genre in the start-a-game filter.
- **Switched-off songs** (`songs.active = false`) stay in the catalog but new games leave them out
  entirely: never drawn, never a wrong answer (`createGame` in `src/lib/games.ts`). Games already
  created are unaffected. Clip lengths are `CLIP_LENGTHS` in `src/lib/clips.ts` (5/10/20/30 s).
- **Live updates:** anything that changes a game calls `publishGameUpdate(gameId)` (`src/lib/live.ts`,
  Postgres NOTIFY, so it reaches every app instance). `/api/live` streams "update" events (game id
  only, no game data) to `<LiveRefresh>`, which calls `router.refresh()`; it holds off while music is
  playing and falls back to 20 s polling if the feed is closed or silent (heartbeat every 25 s).
  Mount it only on screens where nobody is mid-song. New code that changes game state must publish.
- **Game history is a snapshot:** each `game_songs` row keeps a copy of the song's details (`song`
  jsonb) and `song_id` has no foreign key, so catalog songs can be deleted (or edited) without
  touching past or running games. Read song details from `gs.song`, never by joining `songs`
  (join only to check the full-length file still exists).
- **Rounds:** `games.current_position` is the first song of the open round; `openRound()` gives its
  end. A player's next song is the lowest open one they haven't answered (`startSong` refuses any
  other). A song completes when everyone has answered it (`completeSongIfDone`); the round moves on
  when all its songs are complete (`advanceIfRoundDone`). Picks for a song are shown only to players
  who have answered it (`loadGameView`), so nothing gives an answer away.
- **Clips are temporary:** a clip file is deleted once everyone has answered its song
  (`completeSongIfDone`) or its game ends early (`cancelGame`); `scripts/cleanup-clips.mjs`
  sweeps leftovers on every start.
- **Admin screens never show the songs of a game in progress** (the admin plays too): see
  `src/lib/admin-games.ts`. Clips have random file names, are only served to players in that game
  and never ahead of that player's next song (`mayPlayClip`); the full song unlocks only after a
  player answers.
  The catalog page's "Download catalog (CSV)" (`/api/admin/catalog`, `catalogExport`) counts plays
  from finished and ended games only, for the same reason.
- Phone screens: max width `max-w-md`, respect safe areas, inputs at 16px+ so iOS doesn't zoom.
  Admin screens are laid out for a desktop browser.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- `npm test` (Vitest) runs unit tests (`test/unit`) and database tests (`test/integration`) against a
  real Postgres with ffmpeg cutting real clips. It recreates the database named in
  `TEST_DATABASE_URL` (default `postgres://postgres@127.0.0.1:5432/randomnoise_test`; the name must
  contain "test") and writes files under `TEST_DATA_DIR` (default: the OS temp folder). Emails only
  print; `RESEND_API_KEY` is forced empty.
- GitHub Actions (`.github/workflows/ci.yml`) runs all four on every pull request and push to `main`.
- Pure logic lives in modules without server-only imports so it can be unit tested: `rules.ts`,
  `clips.ts`, `song-filters.ts`, `draw.ts` (song draw, artist limit, wrong answers), `normalize.ts`,
  `modes.ts` (rounds per game mode), `genres.ts`, `csv.ts`.
- **Artist limit:** a game has at most one song per artist for every five songs
  (`maxSongsPerArtist` in `src/lib/draw.ts`); it never blocks a game, it spreads artists as evenly
  as the catalog allows.
