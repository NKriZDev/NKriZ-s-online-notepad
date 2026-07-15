import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export function verifier(credential: string): string {
  return createHmac("sha256", config.SESSION_PEPPER).update(credential).digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
