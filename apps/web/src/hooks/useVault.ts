import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { cryptoClient } from "../lib/crypto-client";
import { fromBase64, toBase64 } from "../lib/crypto-core";
import { getCursor, localDb, setCursor, type LocalRecord } from "../lib/local-db";
import { tagDefinitions } from "../lib/tags";
import type { FileRecord, PreferencesRecord, VaultRecord } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const chunkSize = 4 * 1024 * 1024;

const defaultPreferences = (): PreferencesRecord => {
  const stamp = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "preferences",
    title: "Preferences",
    parentId: null,
    tags: [],
    favorite: false,
    createdAt: stamp,
    updatedAt: stamp,
    theme: "system",
    accent: "#0f6cbd",
    editorFont: "ui-monospace, SFMono-Regular, Consolas, monospace",
    editorSize: 14,
    lineWrap: true,
    tabSize: 2,
    density: "comfortable",
    sidebarWidth: 272,
    autoLockMinutes: 15,
    clipboardSeconds: 30,
    defaultSecretView: "simple",
    tagDefinitions: tagDefinitions(),
    wallpaper: { kind: "default", value: "" },
    desktopState: { windows: [], iconPositions: {}, iconSlots: { "this-vault": 0, trash: 1, "password-manager": 2 }, appSizes: {}, usage: {}, editors: {}, searchQueries: {} }
  };
};

export type SyncState = "idle" | "syncing" | "offline" | "error";

export function useVault(onAuthExpired: () => void) {
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [syncState, setSyncState] = useState<SyncState>(navigator.onLine ? "idle" : "offline");
  const [syncMessage, setSyncMessage] = useState("");
  const [ready, setReady] = useState(false);
  const syncing = useRef(false);
  const saveQueues = useRef(new Map<string, Promise<void>>());

  const decryptLocal = useCallback(async () => {
    const rows = await localDb.records.toArray();
    const plain: VaultRecord[] = [];
    for (const row of rows) {
      if (row.deleted) continue;
      try {
        const record = await cryptoClient.decryptRecord(row.id, row.revision, row.ciphertext);
        if (record && typeof record === "object" && "kind" in record) plain.push(record);
      } catch {
        setSyncMessage(`Could not decrypt record ${row.id.slice(0, 8)}`);
      }
    }
    if (!plain.some((record) => record.kind === "preferences")) {
      plain.push(defaultPreferences());
    }
    setRecords(plain.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  const pushDirty = useCallback(async () => {
    const dirty = await localDb.records.where("dirty").equals(1).toArray();
    for (const row of dirty) {
      try {
        const result = await api.putRecord(row.id, row.baseRevision, row.ciphertext, row.deleted);
        await localDb.records.update(row.id, { revision: result.revision, baseRevision: result.revision, dirty: 0 });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const current = (error.details as { current?: { revision: number; deleted: boolean; ciphertext: string } }).current;
          if (!current) continue;
          const localPlain = row.deleted ? null : await cryptoClient.decryptRecord(row.id, row.revision, row.ciphertext);
          await localDb.records.put({ id: row.id, revision: current.revision, baseRevision: current.revision, dirty: 0, deleted: current.deleted, ciphertext: current.ciphertext });
          if (localPlain) {
            const conflict: VaultRecord = {
              ...localPlain,
              id: crypto.randomUUID(),
              title: `${localPlain.title} (conflict copy)`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            const ciphertext = await cryptoClient.encryptRecord(conflict, 1);
            await localDb.records.put({ id: conflict.id, revision: 1, baseRevision: 0, dirty: 1, deleted: false, ciphertext });
            setSyncMessage("A concurrent edit was preserved as a conflict copy.");
          }
          continue;
        }
        throw error;
      }
    }
  }, []);

  const pullChanges = useCallback(async () => {
    let cursor = await getCursor();
    let hasMore = true;
    while (hasMore) {
      const page = await api.changes(cursor);
      for (const change of page.changes) {
        const local = await localDb.records.get(change.id);
        if (local?.dirty) continue;
        await localDb.records.put({
          id: change.id,
          revision: change.revision,
          baseRevision: change.revision,
          dirty: 0,
          deleted: change.deleted,
          ciphertext: change.ciphertext
        });
      }
      cursor = page.cursor;
      await setCursor(cursor);
      hasMore = page.hasMore;
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) {
      setSyncState(navigator.onLine ? "idle" : "offline");
      return;
    }
    syncing.current = true;
    setSyncState("syncing");
    try {
      await pullChanges();
      await pushDirty();
      await pullChanges();
      await decryptLocal();
      setSyncState("idle");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onAuthExpired();
      setSyncState(navigator.onLine ? "error" : "offline");
      setSyncMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      syncing.current = false;
    }
  }, [decryptLocal, onAuthExpired, pullChanges, pushDirty]);

  const initialize = useCallback(async () => {
    try {
      await decryptLocal();
      await sync();
    } finally {
      setReady(true);
    }
  }, [decryptLocal, sync]);

  const saveRecord = useCallback(async (record: VaultRecord) => {
    const updated = { ...record, updatedAt: new Date().toISOString() } as VaultRecord;
    setRecords((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    const previous = saveQueues.current.get(updated.id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const local = await localDb.records.get(updated.id);
      const baseRevision = local?.dirty ? local.baseRevision : local?.revision ?? 0;
      const revision = baseRevision + 1;
      const ciphertext = await cryptoClient.encryptRecord(updated, revision);
      await localDb.records.put({ id: updated.id, revision, baseRevision, dirty: 1, deleted: false, ciphertext });
    });
    saveQueues.current.set(updated.id, queued);
    await queued;
    if (saveQueues.current.get(updated.id) === queued) saveQueues.current.delete(updated.id);
    void sync();
    return updated;
  }, [sync]);

  const softDelete = useCallback(async (record: VaultRecord) => {
    await saveRecord({ ...record, deletedAt: new Date().toISOString() });
  }, [saveRecord]);

  const restore = useCallback(async (record: VaultRecord) => {
    const restored = { ...record };
    delete restored.deletedAt;
    await saveRecord(restored);
  }, [saveRecord]);

  const permanentlyDelete = useCallback(async (record: VaultRecord) => {
    setRecords((current) => current.filter((item) => item.id !== record.id));
    const previous = saveQueues.current.get(record.id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const local = await localDb.records.get(record.id);
      const baseRevision = local?.dirty ? local.baseRevision : local?.revision ?? 0;
      const revision = baseRevision + 1;
      const ciphertext = await cryptoClient.encryptRecord(record, revision);
      await localDb.records.put({ id: record.id, revision, baseRevision, dirty: 1, deleted: true, ciphertext });
    });
    saveQueues.current.set(record.id, queued);
    await queued;
    if (saveQueues.current.get(record.id) === queued) saveQueues.current.delete(record.id);
    await sync();
    if (record.kind === "file" && navigator.onLine) await api.deleteBlob(record.blobId).catch(() => undefined);
  }, [sync]);

  const uploadFile = useCallback(async (file: File, parentId: string | null, onProgress: (value: number) => void) => {
    const bytes = await file.arrayBuffer();
    const id = crypto.randomUUID();
    const blobId = crypto.randomUUID();
    const fileKey = await cryptoClient.newFileKey();
    const count = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
    await api.initBlob({ id: blobId, byteSize: bytes.byteLength, chunkSize, chunkCount: count });
    try {
      for (let index = 0; index < count; index++) {
        const part = bytes.slice(index * chunkSize, Math.min(bytes.byteLength, (index + 1) * chunkSize));
        const envelope = await cryptoClient.encryptChunk(fileKey, blobId, index, part);
        await api.putChunk(blobId, index, envelope);
        onProgress(Math.round((index + 1) / count * 100));
      }
      await api.completeBlob(blobId);
      const stamp = new Date().toISOString();
      const record: FileRecord = {
        id, kind: "file", title: file.name, parentId, tags: [], favorite: false,
        createdAt: stamp, updatedAt: stamp, mime: file.type || "application/octet-stream",
        size: file.size, blobId, fileKey, chunkCount: count, chunkSize, sha256: await cryptoClient.sha256(bytes)
      };
      await saveRecord(record);
      return record;
    } catch (error) {
      await api.deleteBlob(blobId).catch(() => undefined);
      throw error;
    }
  }, [saveRecord]);

  const downloadFile = useCallback(async (record: FileRecord) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let index = 0; index < record.chunkCount; index++) {
      const response = await api.getChunk(record.blobId, index);
      const envelope = JSON.parse(decoder.decode(fromBase64(response.ciphertext)));
      const bytes = new Uint8Array(await cryptoClient.decryptChunk(record.fileKey, record.blobId, index, envelope));
      chunks.push(bytes);
      length += bytes.byteLength;
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    if (await cryptoClient.sha256(output.buffer) !== record.sha256) throw new Error("File integrity check failed");
    return new Blob([output], { type: record.mime });
  }, []);

  useEffect(() => {
    const online = () => void sync();
    const offline = () => setSyncState("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [sync]);

  const preferences = useMemo(() => records.find((record): record is PreferencesRecord => record.kind === "preferences") ?? defaultPreferences(), [records]);

  return { records, preferences, ready, syncState, syncMessage, initialize, saveRecord, softDelete, restore, permanentlyDelete, uploadFile, downloadFile, sync };
}
