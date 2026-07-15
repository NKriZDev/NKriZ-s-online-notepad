import { argon2id, createSHA256 } from "hash-wasm";
import type { Envelope, KdfParams } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const defaultKdfParams: KdfParams = { memory: 65_536, iterations: 3, parallelism: 1 };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}

async function hkdf(source: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", owned(source), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(info) },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

export async function derivePasswordKeys(password: string, salt: Uint8Array, params: KdfParams) {
  const root = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: 32,
    outputType: "binary"
  });
  const source = root instanceof Uint8Array ? root : new Uint8Array(root);
  return {
    authCredential: await hkdf(source, "nkriz/auth/v1"),
    wrappingKey: await hkdf(source, "nkriz/wrap/v1")
  };
}

export async function deriveRecoveryKeys(recoveryKey: Uint8Array) {
  return {
    recoveryCredential: await hkdf(recoveryKey, "nkriz/recovery-auth/v1"),
    wrappingKey: await hkdf(recoveryKey, "nkriz/recovery-wrap/v1")
  };
}

export async function encryptBytes(keyBytes: Uint8Array, data: Uint8Array, aad: string): Promise<Envelope> {
  const key = await crypto.subtle.importKey("raw", owned(keyBytes), "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: owned(iv), additionalData: owned(encoder.encode(aad)) }, key, owned(data));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
}

export async function decryptBytes(keyBytes: Uint8Array, envelope: Envelope, aad: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", owned(keyBytes), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: owned(fromBase64(envelope.iv)), additionalData: owned(encoder.encode(aad)) },
    key,
    owned(fromBase64(envelope.ciphertext))
  );
  return new Uint8Array(plain);
}

export async function encryptJson(key: Uint8Array, value: unknown, aad: string): Promise<Envelope> {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function decryptJson<T>(key: Uint8Array, envelope: Envelope, aad: string): Promise<T> {
  return JSON.parse(decoder.decode(await decryptBytes(key, envelope, aad))) as T;
}

export async function encryptRecord(masterKey: Uint8Array, id: string, revision: number, value: unknown): Promise<string> {
  const itemKey = randomBytes(32);
  const wrappedKey = await encryptBytes(masterKey, itemKey, `record-key:${id}:v1`);
  const data = await encryptJson(itemKey, value, `record:${id}:v1:r${revision}`);
  itemKey.fill(0);
  return JSON.stringify({ v: 1, wrappedKey, data });
}

export async function decryptRecord<T>(masterKey: Uint8Array, id: string, revision: number, ciphertext: string): Promise<T> {
  const parsed = JSON.parse(ciphertext) as { v: number; wrappedKey: Envelope; data: Envelope };
  if (parsed.v !== 1) throw new Error("Unsupported encrypted record version");
  const itemKey = await decryptBytes(masterKey, parsed.wrappedKey, `record-key:${id}:v1`);
  try {
    return await decryptJson<T>(itemKey, parsed.data, `record:${id}:v1:r${revision}`);
  } finally {
    itemKey.fill(0);
  }
}

export async function sha256(data: Uint8Array): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  hasher.update(data);
  return hasher.digest("hex");
}

export function recoveryKeyText(bytes: Uint8Array): string {
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

export function parseRecoveryKey(value: string): Uint8Array {
  const raw = value.trim().replace(/[^0-9a-f]/gi, "");
  if (raw.length !== 64) throw new Error("Recovery key must contain 64 hexadecimal characters");
  return Uint8Array.from(raw.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}
