import "server-only";

// Fills in a song's artwork, year, genre and listening links from its title and artist.
// - Apple's free song search (iTunes Search API): artwork, Apple Music link, year, genre.
// - Spotify's API, only if SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set: the exact
//   Spotify link. (song.link's free API, the original plan, now requires a key.) Without it,
//   pages link to a Spotify search instead.
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

/** Lowercase, no accents, no "(Remastered 2011)" / "- Live" / "feat." extras, no punctuation. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/\s+-\s+.*(remaster|live|version|mix|edit|mono|stereo|single|demo).*$/i, " ")
    .replace(/\b(feat|ft|featuring)\.?\s.*$/, " ")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

async function itunesSearch(title: string, artist: string): Promise<LookupResult> {
  const term = `${artist} ${title.replace(/\s*[([].*?[)\]]/g, "")}`;
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    entity: "song",
    limit: "25",
    country: "US",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Apple search returned ${res.status}`);
  const json = (await res.json()) as { results?: ItunesTrack[] };
  return bestItunesMatch(json.results ?? [], title, artist);
}

let spotifyToken: { value: string; expires: number } | null = null;

async function spotifySearch(title: string, artist: string): Promise<string | undefined> {
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
    tracks?: { items?: { name: string; artists: { name: string }[]; external_urls: { spotify?: string } }[] };
  };
  const t = normalize(title);
  const a = normalize(artist);
  const hit = json.tracks?.items?.find(
    (i) => normalize(i.name) === t && i.artists.some((ar) => normalize(ar.name) === a),
  );
  return hit?.external_urls.spotify;
}

/** Look up one song. Throws only when Apple's search itself fails (network, rate limit). */
export async function lookupSong(title: string, artist: string): Promise<LookupResult> {
  const result = await itunesSearch(title, artist);
  try {
    const spotifyUrl = await spotifySearch(title, artist);
    if (spotifyUrl) result.spotifyUrl = spotifyUrl;
  } catch (err) {
    console.error("Spotify lookup failed", err);
  }
  return result;
}
