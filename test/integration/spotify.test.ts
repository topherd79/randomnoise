// "Find exact Spotify links": fills in songs that only have a search link, and
// the same songs in past games' results. Spotify itself is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn) }));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gameSongs, songs } from "@/db/schema";
import { fillSpotifyLinkFor } from "@/lib/catalog";
import { createGame } from "@/lib/games";
import { NO_FILTERS } from "@/lib/song-filters";
import { addSong, addUser, addVariedSongs, resetAll } from "./helpers";

const EXACT = "https://open.spotify.com/track/abc123";

/** A fake Spotify: a token, and a search that knows one track. */
function fakeSpotify(track: { name: string; artist: string } | null) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://accounts.spotify.com/api/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    if (u.startsWith("https://api.spotify.com/v1/search")) {
      const items = track
        ? [
            { name: "Something Else", artists: [{ name: track.artist }], external_urls: { spotify: "https://open.spotify.com/track/wrong" } },
            { name: track.name, artists: [{ name: track.artist }], external_urls: { spotify: EXACT } },
          ]
        : [];
      return Response.json({ tracks: { items } });
    }
    throw new Error(`Unexpected request in test: ${u}`);
  });
  return calls;
}

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fillSpotifyLinkFor", () => {
  it("saves the exact link on the song and in games that used it", async () => {
    const me = await addUser("Topher");
    const id = await addSong({ title: "Under Pressure (2011 Remaster)", artist: "Queen & David Bowie" });
    await addVariedSongs(5);
    const r = await createGame({ clipLengthSec: 10, wrongAnswers: "random", filters: NO_FILTERS, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);

    fakeSpotify({ name: "Under Pressure", artist: "Queen and David Bowie" });
    expect(await fillSpotifyLinkFor(id)).toBe("found");

    const [song] = await db.select().from(songs).where(eq(songs.id, id));
    expect(song.spotifyUrl).toBe(EXACT);
    for (const gs of await db.select().from(gameSongs).where(eq(gameSongs.songId, id))) {
      expect(gs.song.spotifyUrl).toBe(EXACT);
    }
  });

  it("leaves songs alone when Spotify has no match, or a link is already there", async () => {
    const none = await addSong({ title: "Home Recording", artist: "My Band" });
    const calls = fakeSpotify(null);
    expect(await fillSpotifyLinkFor(none)).toBe("not_found");
    const [song] = await db.select().from(songs).where(eq(songs.id, none));
    expect(song.spotifyUrl).toBeNull();

    const typedIn = await addSong({ title: "Typed In", artist: "Someone" });
    await db.update(songs).set({ spotifyUrl: "https://open.spotify.com/track/mine" }).where(eq(songs.id, typedIn));
    const before = calls.length;
    expect(await fillSpotifyLinkFor(typedIn)).toBe("skipped");
    expect(calls.length).toBe(before); // didn't even ask Spotify
    const [kept] = await db.select().from(songs).where(eq(songs.id, typedIn));
    expect(kept.spotifyUrl).toBe("https://open.spotify.com/track/mine");
  });

  it("tells wrong keys apart from Spotify being busy", async () => {
    const id = await addSong({ title: "Song", artist: "Artist" });
    vi.resetModules(); // forget the token from earlier tests
    const catalog = await import("@/lib/catalog");
    const lookup = await import("@/lib/lookup");
    vi.stubGlobal("fetch", async () => new Response("invalid_client", { status: 400 }));
    await expect(catalog.fillSpotifyLinkFor(id)).rejects.toBeInstanceOf(lookup.SpotifyKeysError);
  });

  it("reports Spotify errors instead of guessing", async () => {
    const id = await addSong({ title: "Song", artist: "Artist" });
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429 }));
    await expect(fillSpotifyLinkFor(id)).rejects.toThrow(/429/);
  });
});
