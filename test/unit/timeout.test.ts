import { describe, expect, it } from "vitest";
import { TimeoutError, withTimeout } from "@/lib/timeout";

describe("withTimeout", () => {
  it("passes through a reply that comes in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });
  it("passes through a failure that comes in time", async () => {
    await expect(withTimeout(Promise.reject(new Error("nope")), 50)).rejects.toThrow("nope");
  });
  it("gives up on a reply that never comes", async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toBeInstanceOf(TimeoutError);
  });
});
