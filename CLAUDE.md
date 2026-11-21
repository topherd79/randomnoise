@AGENTS.md

# Random Noise

A private, turn-based song-guessing game for a small group of friends (1–5 players per game),
played in mobile Safari on iPhones. Hosted on Railway, email through Resend, domain randomnoise.ai.

The full product decisions (and the reasoning behind them) live in the decision log:
https://claude.ai/artifact/H477Nc2h2RAwzVDDH8VHva — read it before changing game rules.

## The game in one paragraph

The admin uploads songs (full mp3s) into a running catalog. A game draws its songs at random from
unplayed songs (only songs switched on in the catalog); "Include songs from earlier games" (the form's
default, with 20-second clips) instead draws at random from every song, new or played (`songPool` in `createGame`).
Optional decade and genre filters (`src/lib/song-filters.ts`) narrow the draw: any option within a filter, all
filters together. A genre chip cycles off → included (green) → left out (red, `excludeGenres`: never drawn;
songs with no genre stay in). A song with several genres is in when any of them is green and out when any
is red (red wins); `createGame` runs the same `matchesFilters` as the form. Wrong answers then come from the
filtered set when it has enough songs. Each
chip's count follows the other picks (`chipCounts`), and a chip that's off and would leave no songs is dimmed. Picked
artists don't narrow anything: their songs come first, all picked artists alike and with no per-artist limit,
and other songs fill the rest (`pickWithPreferred` in `src/lib/draw.ts`); a picked artist's song gets the
picked artists' songs as wrong answers when there are enough. For each song, a player taps Play: a short clip and the answer clock start together, four
"Title – Artist" choices (1 right, 3 random other catalog songs) reveal letter by letter and finish
together, and a faster correct answer scores more (1,000 sliding to 100; a wrong answer loses a third
of what a right one would have earned, so guessing is worth zero on average). Players
answer on their own time. Songs open in rounds, by game mode (`src/lib/modes.ts`): **The OG** one
song at a time (5–25 songs), **3 songs** three at a time (6/9/15/18 songs), **All songs** every song
open from the start (5–25 songs). The next round opens only when everyone has answered every song in
this one. **Pass the Aux** is for one room: players take turns, 5 songs each (see below). Once you've answered a song you see everyone's picks for it so far; standings (the podium tab on the
right edge) show each player's points for every song they've answered so far ("12 of 15 played"), and tapping a name in
them shows that player's song-by-song history
(only songs you've answered). Once everyone else has played every open song, the one player left sees
"Sarah and Topher are waiting on you" on the home card and game page (`waitingOnYouText` in `modes.ts`). The admin also plays, so admin screens never show the songs of a game
in progress.

## Pass the Aux (in one room)

- Pure rules and timings in `src/lib/aux.ts`; server side in `src/lib/aux-game.ts`; the phone screen is
  `src/app/game/[id]/AuxGame.tsx`, talking to `/api/aux/[id]` (GET: the game for this player; POST: a tap).
- Creating the game draws a random turn order (`game_players.turn_order`) and opens a lobby
  (`games.turn_starts_at` is null). Everyone taps I'm in (`joined_at`); the first player in turn order
  who's in gets Start. 30 s after the last I'm in, they can start without whoever's missing: those
  players are removed, everyone moves up a number, and songs beyond 5 a player are deleted with their
  clips. The home page sends players straight to an open lobby (`openLobbyFor`; `/?stay=1` skips it).
- Song p is player ((p − 1) mod n) + 1's turn. The server keeps the clock: `turn_starts_at` is when the
  current song's clip should start; the turn ends 5 s after the later of the clip ending and the
  answers finishing (`turnLengthMs`). Scoring is unchanged, from `answers.started_at` (when the clip
  really started on the turn player's phone). A turn that runs out is scored as an answer with no pick
  and 0 points by `settleAuxTurn`, which every state request runs, so a dead phone can't stall the game.
  After each song: 3 s result, 3 s countdown (`finishTurn` sets the next `turn_starts_at`).
- The phone page never reloads mid-game: the "I'm in" (or Start, or Play) tap plays a moment of silence
  on the page's one `<audio>`, which lets iPhones start each later clip on cue with no tap. If a cue
  fails anyway, the turn player gets a big Play button and the turn keeps running. Wake Lock keeps the
  screen on (iOS 16.4+). The answered song keeps playing through the result and countdown, then stops
  as the next song starts (iPhones can't fade a page's volume).
- Only the turn player's phone gets the clip (`mayPlayAuxClip`), only they can play or answer; every
  phone gets the choices in the turn player's order, never which is right until the song is over. A
  song's clip is deleted when the song after it ends (it plays through the changeover); the last
  one 40 s after the game. Nudges and resets don't apply; the other modes' `startSong`/`answerSong`
  refuse Pass the Aux songs.
- These games count like any other (profiles, wins, "new songs", admin lists, CSV). Each song has one
  pick, its player's, so results and the admin grid show "–" for everyone else.

## Chat

- One chat per exact group of players, kept across their games (`chats.member_key` = the members' ids,
  sorted). `createGame` joins every game of 2+ players to its group's chat (`games.chat_id`); solo and Pass
  the Aux games have none. Migration 0010 made chats for the groups that had already played.
- Spoilers: each message stores, for each game the group had running, the furthest song its writer had
  heard (`chat_messages.holds`). Anyone in that game who hasn't answered that song gets the message
  without its words (`heldUntil` in `src/lib/chat-rules.ts`) and the panel shows sparkles; once the game
  is over everything shows. The words of a held-back message never leave the server (`loadChat`).
- Text and emoji, plus reactions (one per person per message; the same one again takes it back). No
  deleting, no emails: the unread count on the tab is the only alert (`chat_members.last_read_at`).
  A removed player's messages keep their name (`sender_name`). The admin sees only the chats they're in.
- The chat panel: 12 px bubbles 3 px apart, the sender's name only when the sender changes, reactions in
  one badge on the bubble's top-right corner (a count only above 1; tap it for the picker). No time on
  each bubble: a "11/21 · 8:02 PM" line before the first message and wherever an hour or more has passed
  (`stampBefore`, `stampText` in `chat-rules.ts`, the phone's own time). It opens at the newest message and
  stays pinned there (new messages, the keyboard shrinking the panel: a `ResizeObserver`) unless you've
  scrolled up; tapping the box pins it again. The box's text stays 16 px so iPhones don't zoom in.
- **Side tabs** (`src/components/SideTabs.tsx`): two tabs stacked on the right edge, chat on top (unread
  count in its bubble) and a podium under it. Each slides its panel in over the page; the open tab joins
  its panel like a folder tab and the other keeps its outline (tap it to switch). On a game page: the
  group's chat, and the standings (`Standings` with `bare`), which are no longer on the page; a finished
  game keeps its final standings on the page and gets no podium. On the home page: your chats, and all
  your past games (no longer listed on the page). Tabs and panels share one see-through background
  (`GLASS`); what's inside stays solid. Not in Pass the Aux (it has its scores strip), and both hide
  while a song is playing (`PlayRound` sends `rn:song`). The chat talks to `/api/chat` and
  `/api/chat/[id]` with fetch (never a page reload) and gets "chat" events from `/api/live`
  (`publishChatUpdate`). `<LiveRefresh>` waits while a panel is open, then catches up.
- **The page behind an open panel holds still** (`lockPageScroll`, `src/lib/scroll-lock.ts`): `overflow:
  hidden` isn't enough on an iPhone, where with the keyboard up a drag moves the whole visible area. So the
  body is pinned (`position: fixed`, shifted by the scroll, put back on close) and a drag is stopped unless
  it's inside a panel list marked `data-panel-scroll` that can still scroll that way (`blocksDrag`); a
  press in the message box is left alone (it moves the cursor). New scrolling lists in a panel need the mark.
- **Nothing in a panel leaves it:** a past game and a name's profile button use `PanelLink`
  (`src/components/PanelNav.tsx`): inside a panel it opens the page in the panel, on top of what was
  there, with a back arrow naming the page under it; anywhere else it's an ordinary link. The pages
  (`src/components/PanelPages.tsx`) fetch `/api/games/[id]` (`overGameView`: games that are over, for
  their players) and `/api/players/[id]` (`profileCard`: the short profile, yours included). A game over
  shows the same `Final` as its game page. Back keeps each page as you left it; reopening the podium
  starts at its top; closing the panel pauses a song playing in it. Music links still open the app.

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
- **Uploads** (`src/app/admin/catalog/Uploader.tsx`) go one file at a time; a dropped connection
  (status 0, 499 or 5xx, or the server's "The upload was interrupted.") retries after 3, 10 and 30 s,
  and "Retry N failed uploads" re-queues the rest. The same file twice is skipped (`songs.file_hash`).
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
- **Genres:** a song can have several, stored in `songs.genre` as one line ("Pop, Rock").
  `genreList()` (`src/lib/genres.ts`) is how code reads them: it splits on "/", ",", ";", "|" or a dash
  with spaces ("Punk - New Wave"), never on a space, "&" or a plain dash ("Hard Rock", "R&B", "Hip-Hop"
  stay whole; so does "Singer/Songwriter"), and maps French and variant names ("Alternatif et Indé").
  Old game snapshots still say "Pop/Rock" and read the same way. `canonicalGenres()` stores them on
  upload, lookup and edit; migration 0008 split the existing songs. No parent genres: Hard Rock isn't Rock. The catalog
  flags a song with no genre or no year (once its lookup has run) with an orange "Missing genre" /
  "Missing year" chip, and each artist row counts them.
- **Switched-off songs** (`songs.active = false`) stay in the catalog but new games leave them out
  entirely: never drawn, never a wrong answer (`createGame` in `src/lib/games.ts`). Games already
  created are unaffected. Clip lengths are `CLIP_LENGTHS` in `src/lib/clips.ts` (5/10/20/30 s).
- **Live updates:** anything that changes a game calls `publishGameUpdate(gameId)` (`src/lib/live.ts`,
  Postgres NOTIFY, so it reaches every app instance). `/api/live` streams "update" events (game id
  only, no game data) to `<LiveRefresh>`, which calls `router.refresh()`; it holds off while music is
  playing (or a side panel is open) and falls back to 20 s polling if the feed is closed or silent (heartbeat
  every 25 s). Chats use the same feed: `publishChatUpdate(chatId)` sends a "chat" event.
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
- **Profiles** (`src/lib/profiles.ts`, numbers in `src/lib/profile-stats.ts`): `/profile` (your own, with
  past games at `/profile/games`) and `/players/[id]` (a friend's short version, `ProfileSummary`, reached
  from a name in a finished game's standings; in a side panel the same summary opens in the panel). Only games that are over count: finished games, plus the finished songs of games ended early
  (which count toward the numbers but not as a game played or won). A game played alone is never a win.
  Best and worst genre and decade go by average points a song, with at least 5 songs. Anyone you've played
  a game with can open your profile (`maySeeProfile`); the admin can open anyone's.
- **Admin games:** the Games page shows the 5 most recent games; `/admin/games/all` lists every game with
  status, mode and player filters, 25 a page (`gameSummaries`, `countGames` in `src/lib/admin-games.ts`).
- **Admin screens never show the songs of a game in progress** (the admin plays too): see
  `src/lib/admin-games.ts`. Clips have random file names, are only served to players in that game
  and never ahead of that player's next song (`mayPlayClip`); the full song unlocks only after a
  player answers.
  The catalog page's "Download catalog (CSV)" (`/api/admin/catalog`, `catalogExport`) counts plays
  from finished and ended games only, for the same reason.
- **Older iPhones:** `browserslist` in `package.json` adds Safari/iOS 15.4, so the build rewrites newer
  syntax for them. Next 16 targets Safari 16.4+ by default, and its class static blocks stopped all
  JavaScript (so Play did nothing) on an iPhone on iOS 16.2. Every iPhone browser, Chrome included, runs
  the iOS version's Safari engine. On iOS 16.2 the page then froze in Next's `router.refresh()` (the answer
  was saved, then no script ran again), so on Safari/iOS before 16.4 (`isBelowSafari164`,
  `src/lib/older-browser.ts`) `PlayRound` (after an answer) and `<LiveRefresh>` reload the page instead.
  Everywhere, `PlayRound` also waits 6 s for the answer's reply (`withTimeout`, `src/lib/timeout.ts`) and
  reloads if it doesn't come, and a backup reload follows the result if the page didn't move on.
- **Browser errors reach the server log:** `<ClientErrorReporter>` (root layout) and `reportClientError()`
  send script errors from logged-in players to `/api/client-error`, which writes a `[client-error]` line
  (player, page, message, browser, stack) to Railway's deploy logs. Capped per player per hour.
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
  `modes.ts` (rounds per game mode), `aux.ts` (Pass the Aux turns and timings), `chat-rules.ts` (held-back
  messages, reactions, time lines), `scroll-lock.ts` (`blocksDrag`), `genres.ts`, `csv.ts`, `profile-stats.ts` (best guesses, best and
  worst genre and decade, placings).
- **Artist limit:** a game has at most one song per artist for every five songs
  (`maxSongsPerArtist` in `src/lib/draw.ts`), except artists picked on the form; it never blocks a
  game, it spreads artists as evenly as the catalog allows.
