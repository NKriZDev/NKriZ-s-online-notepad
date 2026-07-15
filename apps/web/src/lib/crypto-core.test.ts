import { describe, expect, it } from "vitest";
import {
  decryptRecord,
  derivePasswordKeys,
  encryptRecord,
  parseRecoveryKey,
  randomBytes,
  recoveryKeyText,
  toBase64
} from "./crypto-core";

const testKdf = { memory: 8192, iterations: 1, parallelism: 1 };

describe("zero-knowledge crypto envelopes", () => {
  it("derives stable, purpose-separated credentials", async () => {
    const salt = new Uint8Array(16).fill(7);
    const first = await derivePasswordKeys("correct horse battery staple", salt, testKdf);
    const second = await derivePasswordKeys("correct horse battery staple", salt, testKdf);
    expect(toBase64(first.authCredential)).toBe(toBase64(second.authCredential));
    expect(toBase64(first.authCredential)).not.toBe(toBase64(first.wrappingKey));
  });

  it("round-trips records and binds ciphertext to the revision", async () => {
    const master = randomBytes(32);
    const id = "72d10346-580c-423d-a577-dd810786c970";
    const value = { title: "hidden note", content: "sensitive-token" };
    const ciphertext = await encryptRecord(master, id, 4, value);
    expect(ciphertext).not.toContain("hidden note");
    expect(ciphertext).not.toContain("sensitive-token");
    await expect(decryptRecord(master, id, 4, ciphertext)).resolves.toEqual(value);
    await expect(decryptRecord(master, id, 5, ciphertext)).rejects.toThrow();
  });

  it("rejects a different vault key", async () => {
    const id = "9e3278a4-fba9-41e7-bf92-fca56872bd23";
    const ciphertext = await encryptRecord(randomBytes(32), id, 1, { value: "secret" });
    await expect(decryptRecord(randomBytes(32), id, 1, ciphertext)).rejects.toThrow();
  });

  it("formats recovery keys without ambiguous separators", () => {
    const source = randomBytes(32);
    expect(parseRecoveryKey(recoveryKeyText(source))).toEqual(source);
    expect(() => parseRecoveryKey("not-a-recovery-key")).toThrow();
  });
});
