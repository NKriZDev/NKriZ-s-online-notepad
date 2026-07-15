import type { Bootstrap, EncryptedRecord, Envelope, KdfParams } from "../types";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const isLoopback = typeof window !== "undefined"
  && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const apiBase = (isLoopback ? "" : configuredApiBase).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Request failed", data);
  return data as T;
}

type PasswordBundle = { authCredential: string; authSalt: string; passwordEnvelope: Envelope; kdfParams: KdfParams };

export const api = {
  bootstrap: () => request<Bootstrap>("/api/v1/bootstrap"),
  setup: (body: PasswordBundle & { username: string; recoveryCredential: string; recoveryEnvelope: Envelope }) =>
    request<{ ok: true }>("/api/v1/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (username: string, authCredential: string) =>
    request<{ ok: true }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, authCredential }) }),
  logout: () => request<{ ok: true }>("/api/v1/auth/logout", { method: "POST" }),
  recover: (body: PasswordBundle & { recoveryCredential: string }) =>
    request<{ ok: true }>("/api/v1/auth/recover", { method: "POST", body: JSON.stringify(body) }),
  changePassword: (body: PasswordBundle) =>
    request<{ ok: true }>("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify(body) }),
  changes: (cursor: number) => request<{ changes: EncryptedRecord[] & Array<{ seq: number }>; cursor: number; hasMore: boolean }>(`/api/v1/sync/changes?cursor=${cursor}`),
  putRecord: (id: string, baseRevision: number, ciphertext: string, deleted = false) =>
    request<{ id: string; revision: number; changedAt: string }>(`/api/v1/records/${id}`, {
      method: "PUT", body: JSON.stringify({ baseRevision, ciphertext, deleted })
    }),
  initBlob: (body: { id: string; byteSize: number; chunkSize: number; chunkCount: number }) =>
    request<{ ok: true }>("/api/v1/blobs", { method: "POST", body: JSON.stringify(body) }),
  putChunk: (id: string, index: number, envelope: Envelope) =>
    request<{ ok: true }>(`/api/v1/blobs/${id}/chunks/${index}`, { method: "PUT", body: JSON.stringify(envelope) }),
  completeBlob: (id: string) => request<{ ok: true }>(`/api/v1/blobs/${id}/complete`, { method: "POST" }),
  getChunk: (id: string, index: number) => request<{ ciphertext: string }>(`/api/v1/blobs/${id}/chunks/${index}`),
  deleteBlob: (id: string) => request<{ ok: true }>(`/api/v1/blobs/${id}`, { method: "DELETE" }),
  backup: () => request<unknown>("/api/v1/backup")
};
