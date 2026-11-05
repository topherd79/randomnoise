import { describe, expect, it } from "vitest";
import { gameOverEmail, loginEmail } from "@/lib/email";
import type { GameResults } from "@/lib/game-view";

const results: GameResults = {
  id: "g1",
  status: "finished",
  songCount: 2,
  clipLengthSec: 10,
  createdAt: new Date(),
  finishedAt: new Date(),
  standings: [
    { userId: "u1", name: "Mike", points: 1500, correct: 2 },
    { userId: "u2", name: "Sarah <3", points: 700, correct: 1 },
  ],
  songs: [
    {
      position: 1,
      title: "Rock & Roll <All Night>",
      artist: 'KISS "Live"',
      album: null,
      year: 1975,
      artworkUrl: null,
      appleMusicUrl: "https://music.apple.com/x",
      spotifyUrl: "https://open.spotify.com/track/y",
      picks: [
        { userId: "u1", name: "Mike", label: "Rock & Roll <All Night> – KISS", correct: true, points: 800, elapsedMs: 3000 },
        { userId: "u2", name: "Sarah <3", label: "Other <b>song</b> – Someone", correct: false, points: -200, elapsedMs: 5000 },
      ],
    },
    {
      position: 2,
      title: "Second",
      artist: "Band",
      album: "Album",
      year: 1980,
      artworkUrl: "https://is1.example/art.jpg",
      appleMusicUrl: "https://music.apple.com/z",
      spotifyUrl: "https://open.spotify.com/track/w",
      picks: [
        { userId: "u1", name: "Mike", label: "Second – Band", correct: true, points: 700, elapsedMs: 4000 },
        { userId: "u2", name: "Sarah <3", label: null, correct: null, points: null, elapsedMs: null },
      ],
    },
  ],
};

describe("gameOverEmail", () => {
  it("names the winner and tells each player their place", () => {
    expect(gameOverEmail("Mike", "u1", "https://x/auth/t", results).subject).toBe("Game over: Mike wins");
    expect(gameOverEmail("Mike", "u1", "https://x/auth/t", results).text).toMatch(/You won with 1,500 points/);
    expect(gameOverEmail("Sarah", "u2", "https://x/auth/t", results).text).toMatch(/You finished 2nd with 700 points/);
  });

  it("lists every song with everyone's pick", () => {
    const { text } = gameOverEmail("Mike", "u1", "https://x/auth/t", results);
    expect(text).toMatch(/Song 1: Rock & Roll <All Night> – KISS "Live"/);
    expect(text).toMatch(/Song 2: Second – Band/);
    expect(text).toMatch(/Sarah <3: no answer/);
  });

  it("escapes HTML in titles, names and picks", () => {
    const { html } = gameOverEmail("Mike", "u1", "https://x/auth/t", results);
    expect(html).not.toContain("<All Night>");
    expect(html).not.toContain("<b>song</b>");
    expect(html).not.toContain("Sarah <3");
    expect(html).toContain("Rock &amp; Roll &lt;All Night&gt;");
    expect(html).toContain("KISS &quot;Live&quot;");
  });
});

describe("loginEmail", () => {
  it("escapes the player's name and includes the link", () => {
    const { html, text } = loginEmail("<Mike>", "https://x/auth/abc");
    expect(html).toContain("&lt;Mike&gt;");
    expect(html).not.toContain("<Mike>");
    expect(text).toContain("https://x/auth/abc");
  });
});
