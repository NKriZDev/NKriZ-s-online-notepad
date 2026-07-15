import { describe, expect, it } from "vitest";
import { generatePassword, parseJwt, passwordStrength, totp } from "./totp";

describe("secret helpers", () => {
  it("parses JWT claims locally without implying verification", () => {
    const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjMiLCJleHAiOjIwMDAwMDAwMDB9.";
    const result = parseJwt(token);
    expect(result.payload).toMatchObject({ sub: "123", exp: 2_000_000_000 });
  });

  it("creates six-digit TOTP values", async () => {
    const result = await totp("JBSWY3DPEHPK3PXP", 1_700_000_000_000);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("generates stronger non-ambiguous passwords", () => {
    const value = generatePassword(32);
    expect(value).toHaveLength(32);
    expect(passwordStrength(value).score).toBeGreaterThanOrEqual(2);
  });
});
