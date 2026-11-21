import { describe, expect, it } from "vitest";
import { blocksDrag, CURSOR_HOLD_MS, movesCursor } from "@/lib/scroll-lock";

// A panel's list: 1,000 px of messages in a 400 px window.
const at = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });

describe("holding the page still behind a panel", () => {
  it("lets a list scroll while it can", () => {
    expect(blocksDrag(at(300), 20)).toBe(false); // finger down: toward older messages
    expect(blocksDrag(at(300), -20)).toBe(false); // finger up: toward newer ones
    expect(blocksDrag(at(0), -20)).toBe(false);
    expect(blocksDrag(at(600), 20)).toBe(false);
  });

  it("stops a drag past the list's top or bottom, which would move the page instead", () => {
    expect(blocksDrag(at(0), 20)).toBe(true);
    expect(blocksDrag(at(600), -20)).toBe(true);
    expect(blocksDrag(at(599.5), -20)).toBe(true); // a fraction of a pixel off counts as the bottom
  });

  it("stops every drag in a list too short to scroll", () => {
    expect(blocksDrag(at(0, 300), 20)).toBe(true);
    expect(blocksDrag(at(0, 300), -20)).toBe(true);
  });

  it("leaves a sideways move alone", () => {
    expect(blocksDrag(at(0), 0)).toBe(false);
  });

  it("in the message box, tells a drag (moves at once) from moving the cursor (held still first)", () => {
    expect(movesCursor(40)).toBe(false);
    expect(movesCursor(CURSOR_HOLD_MS - 1)).toBe(false);
    expect(movesCursor(CURSOR_HOLD_MS)).toBe(true);
    expect(movesCursor(800)).toBe(true);
  });
});
