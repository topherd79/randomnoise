import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks, and keeps accents readable", () => {
    const out = toCsv([
      ["Title", "Artist"],
      ['Rock & Roll, "Live"', "Beyoncé"],
      ["Two\nlines", null],
    ]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe('﻿Title,Artist\r\n"Rock & Roll, ""Live""",Beyoncé\r\n"Two\nlines",\r\n');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(toCsv([["=HYPERLINK(1)", "+1", "@x", "-y", 5]])).toBe("﻿'=HYPERLINK(1),'+1,'@x,'-y,5\r\n");
  });
});
