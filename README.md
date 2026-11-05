# Random Noise

A turn-based song-guessing game for a small group of friends. You hear a short clip, four
"Title – Artist" answers reveal letter by letter, and the faster you pick the right one, the more
points you get. Everyone plays on their own time; the group moves on once everyone has answered.

Played on iPhones in the browser at **randomnoise.ai**. One admin manages players, the song catalog
and games from a desktop browser.

## What works so far

- Magic-link login (link → "Tap to log in" page → logged in for a year)
- Admin player list: add, edit, remove, copy a login link, email a login link or invite
- Song catalog: drop in a folder of songs; title and artist come from each file, then artwork, year,
  genre and an Apple Music link are looked up. Each song has a clip setting (surprise me, start of
  song, or spots picked on its sound wave) and can have a custom clip.
- Games: the admin picks 1–5 players, 5–25 songs, a clip length and random or "similar era and
  genre" wrong answers. Clips are cut when the game is created. Players tap Play, the four answers
  reveal letter by letter, and the server keeps the clock and the score. When everyone has answered a
  song, everyone sees the picks and standings and the next song opens. Emails: game on, results are
  in, nudge, game over. The admin's game page shows progress only (never the songs) and can reset a
  player's attempt or end a game.

The scoring numbers live in `src/lib/rules.ts`, ready to tune after test games.

## Run it locally

You need Node 22+, ffmpeg and a Postgres database. Song files are stored in `./data` (set `DATA_DIR`
to put them elsewhere).

```bash
npm install
cp .env.example .env.local      # then set DATABASE_URL
DATABASE_URL=postgres://… npm run db:migrate
npm run dev
```

Open http://localhost:3000/login and enter the admin email. Without `RESEND_API_KEY`, the login email
(with its link) prints in the terminal instead of being sent.

## Settings

| Variable | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. On Railway: `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | Public address used in email links, e.g. `https://randomnoise.ai` |
| `ADMIN_EMAIL` | The one admin (also a player). Defaults to `topher.d@me.com` |
| `ADMIN_NAME` | The admin's display name on first login. Defaults to `Topher` |
| `RESEND_API_KEY` | Resend API key. Leave empty locally |
| `EMAIL_FROM` | Sender, e.g. `Random Noise <game@randomnoise.ai>` |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Optional. With a Spotify developer app's keys, songs get exact Spotify links (the catalog's "Find exact Spotify links" fills in songs added earlier); without them, the Spotify button opens a search |
| `DATA_DIR` | Optional. Where song files and clips live. Defaults to the Railway volume, or `./data` locally |

## Tests

```bash
npm test
```

Unit tests plus database tests that play real games against a local Postgres (with ffmpeg cutting
real clips). They recreate the database in `TEST_DATABASE_URL`
(default `postgres://postgres@127.0.0.1:5432/randomnoise_test`). GitHub Actions runs typecheck, lint,
tests and a build on every pull request.

## Deploying

Every push to `main` deploys to Railway (project `randomnoise`, service `randomnoise`, with a
`Postgres` service next to it). Railway builds the `Dockerfile` and runs `npm start`, which applies
database migrations and then starts the app.

The health check (`/api/health`) and restart policy are set in the service's settings in Railway;
there is no `railway.json` because Railway no longer reads it for new services.

The domain randomnoise.ai points to Railway with a CNAME in Cloudflare. Keep that record
**DNS only** (grey cloud): if it's proxied, Railway can't verify the domain.

## Database changes

Edit `src/db/schema.ts`, then run `npm run db:generate` and commit the new SQL file in `drizzle/`.
