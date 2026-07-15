import type { Bootstrap, Envelope, KdfParams, VaultRecord } from "../types";

type Pending = { resolve: (value: never) => void; reject: (reason: Error) => void };
const worker = new Worker(new URL("../workers/crypto.worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, Pending>();
let sequence = 0;

worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
  const request = pending.get(event.data.id);
  if (!request) return;
  pending.delete(event.data.id);
  if (event.data.error) request.reject(new Error(event.data.error));
  else request.resolve(event.data.result as never);
};

function call<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    worker.postMessage({ id, operation, payload });
  });
}

export type VaultSetup = {
  authSalt: string;
  authCredential: string;
  recoveryCredential: string;
  passwordEnvelope: Envelope;
  recoveryEnvelope: Envelope;
  recoveryKey: string;
  kdfParams: KdfParams;
};

export const cryptoClient = {
  createVault: (password: string) => call<VaultSetup>("createVault", { password }),
  unlockPassword: (password: string, bootstrap: Bootstrap) => call<{ authCredential: string }>("unlockPassword", {
    password,
    authSalt: bootstrap.authSalt,
    passwordEnvelope: bootstrap.passwordEnvelope,
    kdfParams: bootstrap.kdfParams
  }),
  unlockRecovery: (recoveryKey: string, bootstrap: Bootstrap) => call<{ recoveryCredential: string }>("unlockRecovery", {
    recoveryKey,
    recoveryEnvelope: bootstrap.recoveryEnvelope
  }),
  rewrapPassword: (password: string) => call<Pick<VaultSetup, "authSalt" | "authCredential" | "passwordEnvelope" | "kdfParams">>("rewrapPassword", { password }),
  encryptRecord: (record: VaultRecord, revision: number) => call<string>("encryptRecord", { id: record.id, revision, value: record }),
  decryptRecord: (id: string, revision: number, ciphertext: string) => call<VaultRecord>("decryptRecord", { id, revision, ciphertext }),
  newFileKey: () => call<string>("newFileKey"),
  encryptChunk: (fileKey: string, blobId: string, index: number, bytes: ArrayBuffer) => call<Envelope>("encryptChunk", { fileKey, blobId, index, bytes }),
  decryptChunk: (fileKey: string, blobId: string, index: number, envelope: Envelope) => call<ArrayBuffer>("decryptChunk", { fileKey, blobId, index, envelope }),
  sha256: (bytes: ArrayBuffer) => call<string>("sha256", { bytes }),
  lock: () => call<boolean>("lock")
};
