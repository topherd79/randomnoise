import "server-only";
import { normalize } from "./normalize";

// normalize() lives in ./normalize (pure, testable); re-exported for existing callers.
export { normalize };

// Fills in a song's artwork, year, genre and listening links from its title and artist.
// - Apple's free song search (iTunes Search API): artwork, Apple Music link, year, genre.
// - Spotify's API, only if SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set: the exact
//   Spotify link. (song.link's free API, the original plan, now requires a key.) Without it,
//   pages link to a Spotify search instead. When Apple's search doesn't have a song at all
//   (it misses some, like Tame Impala's "The Less I Know The Better"), the artwork, album
//   and year come from Spotify's match instead.
// Apple allows roughly 20 searches a minute, so the catalog page runs lookups one at a
// time (see LookupRunner) rather than all at once after a bulk upload.

const USER_AGENT = "RandomNoise/1.0 (+https://randomnoise.ai)";

export type LookupResult = {
  found: boolean;
  album?: string;
  year?: number;
  genre?: string;
  artworkUrl?: string;
  appleMusicUrl?: string;
  spotifyUrl?: string;
};



type ItunesTrack = {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
};

/** Pick the best Apple result for a title and artist. Exported for tests. */
export function bestItunesMatch(results: ItunesTrack[], title: string, artist: string): LookupResult {
  const t = normalize(title);
  const a = normalize(artist);
  const matches = results.filter((r) => {
    const rt = normalize(r.trackName ?? "");
    const ra = normalize(r.artistName ?? "");
    const titleOk = rt === t || (t.length > 3 && (rt.startsWith(t) || t.startsWith(rt)));
    const artistOk = ra === a || (a.length > 2 && (ra.includes(a) || a.includes(ra)));
    return titleOk && artistOk;
  });
  if (matches.length === 0) return { found: false };

  const isLive = (r: ItunesTrack) => /\blive\b/i.test(`${r.collectionName} ${r.trackName}`) && !/\blive\b/i.test(title);
  const isCompilation = (r: ItunesTrack) => /greatest hits|best of|essential|collection|anthology|hits/i.test(r.collectionName ?? "");
  const rank = (r: ItunesTrack) => (isLive(r) ? 2 : 0) + (isCompilation(r) ? 1 : 0);
  const best = [...matches].sort((x, y) => rank(x) - rank(y))[0];

  // The year the song first came out: the earliest release among the studio matches.
  const years = matches
    .filter((r) => !isLive(r))
    .map((r) => Number((r.releaseDate ?? "").slice(0, 4)))
    .filter((y) => y > 1900);

  let appleMusicUrl = best.trackViewUrl;
  if (appleMusicUrl) {
    const url = new URL(appleMusicUrl);
    url.searchParams.delete("uo");
    appleMusicUrl = url.toString();
  }

  return {
    found: true,
    album: best.collectionName,
    year: years.length ? Math.min(...years) : undefined,
    genre: best.primaryGenreName,
    artworkUrl: best.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb."),
    appleMusicUrl,
  };
}

/** The title without "(2015 Remaster)" or " - Remastered 2011": what Apple's search can find. */
const searchTitle = (title: string) =>
  title
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "")
    .trim() || title;

async function itunesSearch(title: string, artist: string, by: "artist and title" | "title" = "artist and title"): Promise<LookupResult> {
  const term = by === "title" ? searchTitle(title) : `${artist} ${searchTitle(title)}`;
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    entity: "song",
    limit: by === "title" ? "50" : "25",
    country: "US",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Apple search returned ${res.status}`);
  const json = (await res.json()) as { results?: ItunesTrack[] };
  return bestItunesMatch(json.results ?? [], title, artist);
}

let spotifyToken: { value: string; expires: number } | null = null;

/** Spotify turned down SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (as opposed to being busy or down). */
export class SpotifyKeysError extends Error {}

/** Whether exact Spotify links can be looked up (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET set). */
export function spotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim());
}

/**
 * The exact Spotify track link for a title and artist, or undefined if Spotify
 * has no match (or isn't configured). Throws if Spotify's API fails.
 */
export async function findSpotifyLink(title: string, artist: string): Promise<string | undefined> {
  return (await spotifySearch(title, artist))?.url;
}

type SpotifyMatch = { url: string; artworkUrl?: string; album?: string; year?: number };

async function spotifySearch(title: string, artist: string): Promise<SpotifyMatch | undefined> {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return undefined;

  if (!spotifyToken || spotifyToken.expires < Date.now()) {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 400 || res.status === 401) throw new SpotifyKeysError(`Spotify didn't accept the keys (${res.status})`);
    if (!res.ok) throw new Error(`Spotify token request returned ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    spotifyToken = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  }

  const q = `track:${title.replace(/\s*[([].*?[)\]]/g, "")} artist:${artist}`;
  const res = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: "track", limit: "10" })}`, {
    headers: { Authorization: `Bearer ${spotifyToken.value}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Spotify search returned ${res.status}`);
  const json = (await res.json()) as {
    tracks?: {
      items?: {
        name: string;
        artists: { name: string }[];
        external_urls: { spotify?: string };
        album?: { name?: string; release_date?: string; images?: { url: string; width?: number }[] };
      }[];
    };
  };
  const t = normalize(title);
  const a = normalize(artist);
  const hit = json.tracks?.items?.find(
    (i) => normalize(i.name) === t && i.artists.some((ar) => normalize(ar.name) === a),
  );
  if (!hit?.external_urls.spotify) return undefined;
  const year = Number((hit.album?.release_date ?? "").slice(0, 4));
  // Spotify lists the biggest image first (640×640).
  const image = [...(hit.album?.images ?? [])].sort((x, y) => (y.width ?? 0) - (x.width ?? 0))[0];
  return {
    url: hit.external_urls.spotify,
    artworkUrl: image?.url,
    album: hit.album?.name || undefined,
    year: year > 1900 ? year : undefined,
  };
}

/**
 * Look up one song. Throws only when Apple's search itself fails (network, rate limit).
 * If searching for artist and title finds nothing, it tries once more with the
 * title alone (still matching the artist), after a pause that keeps us under
 * Apple's limit of about 20 searches a minute. If Apple still doesn't have it
 * but Spotify does, the song counts as found, with Spotify's artwork, album and
 * year (and no Apple Music link: that button opens a search).
 */
export async function lookupSong(title: string, artist: string, opts: { retryAfterMs?: number } = {}): Promise<LookupResult> {
  let result = await itunesSearch(title, artist);
  if (!result.found) {
    await new Promise((r) => setTimeout(r, opts.retryAfterMs ?? 3500));
    result = await itunesSearch(title, artist, "title");
  }
  try {
    const spotify = await spotifySearch(title, artist);
    if (spotify) {
      result.spotifyUrl = spotify.url;
      if (!result.found) {
        result = { found: true, spotifyUrl: spotify.url, artworkUrl: spotify.artworkUrl, album: spotify.album, year: spotify.year };
      }
    }
  } catch (err) {
    console.error("Spotify lookup failed", err);
  }
  return result;
}
