# Random Noise

A turn-based song-guessing game for a small group of friends. You hear a short clip, four
"Title – Artist" answers reveal letter by letter, and the faster you pick the right one, the more
points you get. Everyone plays on their own time; the group moves on once everyone has answered.

Played on iPhones in the browser at **randomnoise.ai**. One admin manages players, the song catalog
and games from a desktop browser.

## What works so far

- **Login:** magic links only. The link opens a "Tap to log in" page, and only its button logs you in
  (for a year), so email scanners and message previews can't use the link up.
- **Players (admin):** add, edit or remove players; copy or email a login link; send an invite.
- **Catalog (admin):**
  - Drop in a folder of songs. MP3s and iTunes M4As are kept; WAV, AIFF and lossless files become MP3s.
    Uploads go one at a time and retry a dropped connection; the same file twice is skipped.
  - Title and artist come from each file, then artwork, album, year, genre and links are looked up
    (Apple's search, with Spotify as a fallback).
  - Each song can be switched in or out of games. It has a clip setting (surprise me, start of song,
    or spots picked on its sound wave), and can have its own clip length or a custom clip.
  - Browse by artist or recently added, narrow by decade and genre tags, and list songs that need a
    look, the same song uploaded more than once, or songs missing a genre (orange chip). Download the
    whole catalog as a CSV.
- **Starting a game (admin):**
  - Pick a mode: The OG (one song at a time), 3 songs (three at a time), All songs (every song open
    from the start), or Pass the Aux (everyone in one room, taking turns; see below).
  - Pick 1–5 players (2–5 for Pass the Aux), the number of songs (Pass the Aux: 5 a player), a clip
    length (20 seconds by default), and random or "similar era and genre" wrong answers.
  - Which songs: "New songs only", or "Include songs from earlier games" (the default), which draws at
    random from every song.
  - Optional filters: decades; genres to include (green) or leave out (red); and artists whose songs
    come first, without the usual one-song-per-artist-for-every-five limit. Each decade and genre
    chip's count follows your other picks, and a chip that would leave no songs is dimmed.
- **Playing:** tap Play; the clip starts and four answers reveal letter by letter, and the server keeps
  the clock and the score. After answering you see everyone's picks so far; the next round opens when
  everyone has played every open song. Standings show everyone's points so far; tap a name for that
  player's song-by-song history. Pages update by themselves as others play. When everyone else is
  done, the last player sees who's waiting on them.
- **Pass the Aux:** for when everyone is in the same room. The game opens a lobby with a random turn
  order ("You're player 2"); everyone taps I'm in, and player 1 taps Start (30 seconds after the last
  I'm in, they can start without anyone missing). Players take turns: only the turn player's phone
  plays the clip and only they can answer, while every other phone shows the same countdown, answers
  and points live. A turn ends 5 seconds after the clip ends or the answers finish, whichever is later
  (no answer scores 0); then everyone sees the result for 3 seconds and a 3-2-1 countdown to the next
  player. The full songs and links are in the recap at the end.
- **Chat:** every group of players (2 or more, not Pass the Aux) has one chat, kept across all their
  games. A small tab on the right edge of the home and game pages shows your unread count; tap it and
  the chat slides in. A message written further into a game than you've played shows as sparkles
  until you catch up, so chat never spoils a song. Text and emoji, plus reactions (touch and hold).
- **Profiles:** your profile (games, wins, % right, average answer time, top three guesses, best and
  worst genre and decade) and every past game; a friend's short profile from a name in the standings.
  Only games that are over count.
- **Admin games:** a game in progress shows progress only, never the songs, since the admin plays too.
  The admin can reset a player's attempt or end a game early. The Games page shows the 5 most recent
  games, and All games lists every game with status, mode and player filters. A game that's over
  shows every song and pick.
- **Emails:** invite, login link, game on, nudge, and game over (with every song's results).

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
