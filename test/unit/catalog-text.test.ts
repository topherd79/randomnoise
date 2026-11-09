import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanTitle, songKey } from "@/lib/normalize";
import { canonicalGenre } from "@/lib/genres";
import { choiceLabel } from "@/lib/rules";
import { lookupSong } from "@/lib/lookup";

describe("cleanTitle (answer choices)", () => {
  it("drops release labels", () => {
    expect(cleanTitle("1979 (Remastered 2012)")).toBe("1979");
    expect(cleanTitle("10 Days Late (2006 Remastered LP Version)")).toBe("10 Days Late");
    expect(cleanTitle("All Star (Album Version)")).toBe("All Star");
    expect(cleanTitle("Steal My Sunshine  (Single Version)")).toBe("Steal My Sunshine");
    expect(cleanTitle("Lovefool (Radio Edit)")).toBe("Lovefool");
    expect(cleanTitle("Get Lucky (feat. Pharrell Williams and Nile Rodgers)")).toBe("Get Lucky");
    expect(cleanTitle("Heroes - 2017 Remaster")).toBe("Heroes");
    expect(cleanTitle("Gold Digger (Album Version (Explicit))")).toBe("Gold Digger");
    expect(cleanTitle("Slow Motion (Instrumental) [2008 Remaster]")).toBe("Slow Motion (Instrumental)");
  });

  it("keeps labels that matter to the guess", () => {
    expect(cleanTitle("Push (Acoustic)")).toBe("Push (Acoustic)");
    expect(cleanTitle("Alice Childress (Live at KCRW, Los Angeles, CA - 10/16/1995)")).toBe(
      "Alice Childress (Live at KCRW, Los Angeles, CA - 10/16/1995)",
    );
    expect(cleanTitle("Bad Blood (Taylor's Version)")).toBe("Bad Blood (Taylor's Version)");
    expect(cleanTitle("Float On (Dan the Automator Remix)")).toBe("Float On (Dan the Automator Remix)");
    expect(cleanTitle("(Nice Dream)")).toBe("(Nice Dream)");
  });

  it("is what the choices show", () => {
    expect(choiceLabel({ title: "Wonderwall (Remastered)", artist: "Oasis" })).toBe("Wonderwall – Oasis");
  });
});

describe("songKey (copies count as one song)", () => {
  it("matches copies and versions of the same song", () => {
    expect(songKey("Wonderwall (Remastered)", "Oasis")).toBe(songKey("Wonderwall", "Oasis"));
    expect(songKey("Deep Inside Of You (2006 Remastered LP Version)", "Third Eye Blind")).toBe(
      songKey("Deep Inside of You (2008 Remaster)", "Third Eye Blind"),
    );
    expect(songKey("Get Lucky", "Daft Punk feat. Pharrell Williams")).toBe(songKey("Get Lucky", "Daft Punk"));
  });

  it("keeps different songs apart", () => {
    expect(songKey("Perfect", "Simple Plan")).not.toBe(songKey("Perfect", "Alanis Morissette"));
    expect(songKey("Run", "Snow Patrol")).not.toBe(songKey("Runaway", "Snow Patrol"));
  });
});

describe("canonicalGenre", () => {
  it("folds French and variant genre names into one English name", () => {
    expect(canonicalGenre("Alternatif et Indé")).toBe("Alternative");
    expect(canonicalGenre("Alternative & Indie")).toBe("Alternative");
    expect(canonicalGenre("Électronique")).toBe("Electronic");
    expect(canonicalGenre(" Variété internationale ")).toBe("Pop");
  });

  it("keeps other genres as they are", () => {
    expect(canonicalGenre("Pop/Rock")).toBe("Pop/Rock");
    expect(canonicalGenre("Trip Hop")).toBe("Trip Hop");
    expect(canonicalGenre("")).toBeNull();
    expect(canonicalGenre(null)).toBeNull();
  });
});

describe("lookupSong", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tries the title on its own when artist + title finds nothing", async () => {
    const terms: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const term = new URL(String(url)).searchParams.get("term")!;
      terms.push(term);
      const results =
        terms.length === 1
          ? []
          : [{ trackName: "You Oughta Know (2015 Remaster)", artistName: "Alanis Morissette", collectionName: "Jagged Little Pill", releaseDate: "1995-06-13T07:00:00Z", primaryGenreName: "Rock", trackViewUrl: "https://music.apple.com/us/x" }];
      return Response.json({ results });
    });
    const r = await lookupSong("You Oughta Know (2015 Remaster)", "Alanis Morissette", { retryAfterMs: 0 });
    expect(terms).toEqual(["Alanis Morissette You Oughta Know", "You Oughta Know"]);
    expect(r).toMatchObject({ found: true, year: 1995, album: "Jagged Little Pill" });
  });

  it("takes artwork, album and year from Spotify when Apple doesn't have the song", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://itunes.apple.com/")) return Response.json({ results: [] });
      if (u.startsWith("https://accounts.spotify.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
      return Response.json({
        tracks: {
          items: [
            {
              name: "The Less I Know The Better",
              artists: [{ name: "Tame Impala" }],
              external_urls: { spotify: "https://open.spotify.com/track/abc" },
              album: {
                name: "Currents",
                release_date: "2015-07-17",
                images: [
                  { url: "https://i.scdn.co/image/small", width: 64 },
                  { url: "https://i.scdn.co/image/big", width: 640 },
                ],
              },
            },
          ],
        },
      });
    });
    const r = await lookupSong("The Less I Know The Better", "Tame Impala", { retryAfterMs: 0 });
    expect(r).toEqual({
      found: true,
      spotifyUrl: "https://open.spotify.com/track/abc",
      artworkUrl: "https://i.scdn.co/image/big",
      album: "Currents",
      year: 2015,
    });
    vi.unstubAllEnvs();
  });

  it("doesn't take a same-titled song by someone else", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ results: [{ trackName: "Perfect", artistName: "Ed Sheeran", releaseDate: "2017-03-03T00:00:00Z" }] }),
    );
    expect((await lookupSong("Perfect", "Simple Plan", { retryAfterMs: 0 })).found).toBe(false);
  });
});
