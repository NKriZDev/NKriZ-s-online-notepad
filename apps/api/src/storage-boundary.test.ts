import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

describe("Prisma zero-knowledge storage boundary", () => {
  it("has no plaintext content metadata columns on encrypted records", () => {
    const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === "VaultRecord");
    expect(model).toBeDefined();
    const fields = model?.fields.map((field) => field.name) ?? [];
    expect(fields).toEqual(expect.arrayContaining(["id", "revision", "deleted", "ciphertext"]));
    expect(fields).not.toEqual(expect.arrayContaining(["title", "content", "filename", "tags", "folderId", "username", "password"]));
  });
});
