import { describe, expect, it } from "vitest";
import { canonicalGenres, genreList } from "@/lib/genres";

describe("several genres in one name", () => {
  it("splits on slashes, commas, semicolons and a spaced dash", () => {
    expect(genreList("Pop/Rock")).toEqual(["Pop", "Rock"]);
    expect(genreList("Rock / Pop")).toEqual(["Rock", "Pop"]);
    expect(genreList("Soul/Funk/R&B")).toEqual(["Soul", "Funk", "R&B"]);
    expect(genreList("Punk - New Wave")).toEqual(["Punk", "New Wave"]);
    expect(genreList("Punk – New Wave")).toEqual(["Punk", "New Wave"]);
    expect(genreList("Rock, Pop; Folk")).toEqual(["Rock", "Pop", "Folk"]);
  });

  it("never splits a genre whose name has a space, an & or a plain dash", () => {
    expect(genreList("Hard Rock")).toEqual(["Hard Rock"]);
    expect(genreList("New Wave")).toEqual(["New Wave"]);
    expect(genreList("Trip Hop")).toEqual(["Trip Hop"]);
    expect(genreList("R&B")).toEqual(["R&B"]);
    expect(genreList("Drum & Bass")).toEqual(["Drum & Bass"]);
    expect(genreList("Hip-Hop")).toEqual(["Hip-Hop"]);
    expect(genreList("Synth-pop")).toEqual(["Synth-pop"]);
    expect(genreList("Post-punk")).toEqual(["Post-punk"]);
    expect(genreList("Hard Rock/Pop")).toEqual(["Hard Rock", "Pop"]);
  });

  it("keeps Singer/Songwriter whole, even inside a longer name", () => {
    expect(genreList("Singer/Songwriter")).toEqual(["Singer/Songwriter"]);
    expect(genreList("singer / songwriter")).toEqual(["Singer/Songwriter"]);
    expect(genreList("Singer/Songwriter/Folk")).toEqual(["Singer/Songwriter", "Folk"]);
    expect(genreList("Auteur-compositeur")).toEqual(["Singer/Songwriter"]);
  });

  it("splits Apple's combined genres too, and maps other spellings and languages", () => {
    expect(genreList("Hip-Hop/Rap")).toEqual(["Hip-Hop", "Rap"]);
    expect(genreList("Hip Hop/Rap")).toEqual(["Hip-Hop", "Rap"]);
    expect(genreList("R&B/Soul")).toEqual(["R&B", "Soul"]);
    expect(genreList("Alternatif et Indé")).toEqual(["Alternative"]);
    expect(genreList("Électronique/Pop")).toEqual(["Electronic", "Pop"]);
    expect(genreList("RnB")).toEqual(["R&B"]);
  });

  it("drops repeats and blanks", () => {
    expect(genreList("Rock/rock/ Pop /")).toEqual(["Rock", "Pop"]);
    expect(genreList("  ")).toEqual([]);
    expect(genreList(null)).toEqual([]);
  });

  it("stores the genres as one line, Pop, Rock", () => {
    expect(canonicalGenres("Pop/Rock")).toBe("Pop, Rock");
    expect(canonicalGenres("Pop, Rock")).toBe("Pop, Rock");
    expect(canonicalGenres("Hard Rock")).toBe("Hard Rock");
    expect(canonicalGenres("")).toBeNull();
  });
});
