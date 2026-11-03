# Random Noise

A turn-based song-guessing game for a small group of friends. You hear a short clip, four
"Title – Artist" answers reveal letter by letter, and the faster you pick the right one, the more
points you get. Everyone plays on their own time; the group moves on once everyone has answered.

Played on iPhones in the browser at **randomnoise.ai**. One admin manages players, the song catalog
and games from a desktop browser.

## What works so far

- Magic-link login (link → "Tap to log in" page → logged in for a year)
- Admin player list: add, edit, remove, copy a login link, email a login link or invite

Next up: the song catalog (upload, clip settings, auto-filled details), then games.

## Run it locally

You need Node 22+ and a Postgres database.

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
