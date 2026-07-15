import { describe, expect, it } from "vitest";
import { safeEqual, tokenHash, verifier } from "./security.js";

describe("server-side opaque authentication", () => {
  it("stores a peppered verifier instead of the derived credential", () => {
    const credential = "client-derived-credential-with-high-entropy";
    expect(verifier(credential)).not.toContain(credential);
    expect(safeEqual(verifier(credential), verifier(credential))).toBe(true);
    expect(safeEqual(verifier(credential), verifier(`${credential}!`))).toBe(false);
  });

  it("hashes session tokens before storage", () => {
    const token = "raw-session-token";
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).not.toContain(token);
  });
});
