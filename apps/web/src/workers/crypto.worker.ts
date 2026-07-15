/// <reference lib="webworker" />
import {
  decryptBytes,
  decryptRecord,
  defaultKdfParams,
  derivePasswordKeys,
  deriveRecoveryKeys,
  encryptBytes,
  encryptRecord,
  fromBase64,
  parseRecoveryKey,
  randomBytes,
  recoveryKeyText,
  sha256,
  toBase64
} from "../lib/crypto-core";
import type { Envelope, KdfParams } from "../types";

let masterKey: Uint8Array | null = null;

type Request = { id: number; operation: string; payload: Record<string, unknown> };

async function handle(operation: string, payload: Record<string, unknown>): Promise<unknown> {
  if (operation === "createVault") {
    const salt = randomBytes(16);
    const recovery = randomBytes(32);
    const master = randomBytes(32);
    const params = defaultKdfParams;
    const passwordKeys = await derivePasswordKeys(payload.password as string, salt, params);
    const recoveryKeys = await deriveRecoveryKeys(recovery);
    masterKey?.fill(0);
    masterKey = master;
    return {
      authSalt: toBase64(salt),
      authCredential: toBase64(passwordKeys.authCredential),
      recoveryCredential: toBase64(recoveryKeys.recoveryCredential),
      passwordEnvelope: await encryptBytes(passwordKeys.wrappingKey, master, "vault-master:password:v1"),
      recoveryEnvelope: await encryptBytes(recoveryKeys.wrappingKey, master, "vault-master:recovery:v1"),
      recoveryKey: recoveryKeyText(recovery),
      kdfParams: params
    };
  }
  if (operation === "unlockPassword") {
    const keys = await derivePasswordKeys(payload.password as string, fromBase64(payload.authSalt as string), payload.kdfParams as KdfParams);
    const master = await decryptBytes(keys.wrappingKey, payload.passwordEnvelope as Envelope, "vault-master:password:v1");
    masterKey?.fill(0);
    masterKey = master;
    return { authCredential: toBase64(keys.authCredential) };
  }
  if (operation === "unlockRecovery") {
    const keys = await deriveRecoveryKeys(parseRecoveryKey(payload.recoveryKey as string));
    const master = await decryptBytes(keys.wrappingKey, payload.recoveryEnvelope as Envelope, "vault-master:recovery:v1");
    masterKey?.fill(0);
    masterKey = master;
    return { recoveryCredential: toBase64(keys.recoveryCredential) };
  }
  if (operation === "rewrapPassword") {
    if (!masterKey) throw new Error("Vault is locked");
    const salt = randomBytes(16);
    const params = defaultKdfParams;
    const keys = await derivePasswordKeys(payload.password as string, salt, params);
    return {
      authSalt: toBase64(salt),
      authCredential: toBase64(keys.authCredential),
      passwordEnvelope: await encryptBytes(keys.wrappingKey, masterKey, "vault-master:password:v1"),
      kdfParams: params
    };
  }
  if (operation === "encryptRecord") {
    if (!masterKey) throw new Error("Vault is locked");
    return encryptRecord(masterKey, payload.id as string, payload.revision as number, payload.value);
  }
  if (operation === "decryptRecord") {
    if (!masterKey) throw new Error("Vault is locked");
    return decryptRecord(masterKey, payload.id as string, payload.revision as number, payload.ciphertext as string);
  }
  if (operation === "newFileKey") return toBase64(randomBytes(32));
  if (operation === "encryptChunk") {
    const key = fromBase64(payload.fileKey as string);
    return encryptBytes(key, new Uint8Array(payload.bytes as ArrayBuffer), `blob:${payload.blobId}:chunk:${payload.index}`);
  }
  if (operation === "decryptChunk") {
    const key = fromBase64(payload.fileKey as string);
    const result = await decryptBytes(key, payload.envelope as Envelope, `blob:${payload.blobId}:chunk:${payload.index}`);
    return result.buffer;
  }
  if (operation === "sha256") return sha256(new Uint8Array(payload.bytes as ArrayBuffer));
  if (operation === "lock") {
    masterKey?.fill(0);
    masterKey = null;
    return true;
  }
  throw new Error(`Unknown crypto operation: ${operation}`);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, operation, payload } = event.data;
  try {
    const result = await handle(operation, payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Cryptographic operation failed" });
  }
};
