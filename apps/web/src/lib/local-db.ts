import Dexie, { type EntityTable } from "dexie";
import type { Bootstrap, EncryptedRecord } from "../types";

export type LocalRecord = EncryptedRecord & {
  dirty: number;
  baseRevision: number;
};
type MetaRow = { key: string; value: unknown };

class VaultDatabase extends Dexie {
  records!: EntityTable<LocalRecord, "id">;
  meta!: EntityTable<MetaRow, "key">;

  constructor() {
    super("nkriz-encrypted-vault");
    this.version(1).stores({
      records: "id, revision, dirty, deleted",
      meta: "key"
    });
  }
}

export const localDb = new VaultDatabase();

export async function cacheBootstrap(bootstrap: Bootstrap): Promise<void> {
  await localDb.meta.put({ key: "bootstrap", value: bootstrap });
}

export async function getCachedBootstrap(): Promise<Bootstrap | undefined> {
  return (await localDb.meta.get("bootstrap"))?.value as Bootstrap | undefined;
}

export async function getCursor(): Promise<number> {
  return ((await localDb.meta.get("cursor"))?.value as number | undefined) ?? 0;
}

export async function setCursor(cursor: number): Promise<void> {
  await localDb.meta.put({ key: "cursor", value: cursor });
}
