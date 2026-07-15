const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Uint8Array {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Uint8Array.from(bytes);
}

export async function totp(secret: string, timestamp = Date.now()): Promise<{ code: string; remaining: number }> {
  const counter = Math.floor(timestamp / 30_000);
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(decodeBase32(secret)), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = ((digest[offset] ?? 0) & 0x7f) << 24 |
    (digest[offset + 1] ?? 0) << 16 |
    (digest[offset + 2] ?? 0) << 8 |
    (digest[offset + 3] ?? 0);
  return { code: String(binary % 1_000_000).padStart(6, "0"), remaining: 30 - Math.floor(timestamp / 1000) % 30 };
}

export function parseJwt(token: string): { header?: unknown; payload?: Record<string, unknown>; error?: string } {
  try {
    const [header, payload] = token.split(".");
    if (!header || !payload) throw new Error("JWT must contain three dot-separated segments");
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return { header: decode(header), payload: decode(payload) as Record<string, unknown> };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid JWT" };
  }
}

export function passwordStrength(value: string): { score: number; label: string } {
  let score = 0;
  if (value.length >= 12) score++;
  if (value.length >= 18) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return { score, label: ["Very weak", "Weak", "Fair", "Good", "Strong"][score] ?? "Very weak" };
}

export function generatePassword(length = 24): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}
