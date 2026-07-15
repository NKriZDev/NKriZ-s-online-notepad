import { z } from "zod";

const envelope = z.object({
  iv: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(4096)
});

export const setupSchema = z.object({
  username: z.string().trim().min(1).max(80),
  authCredential: z.string().min(32).max(256),
  recoveryCredential: z.string().min(32).max(256),
  authSalt: z.string().min(16).max(128),
  passwordEnvelope: envelope,
  recoveryEnvelope: envelope,
  kdfParams: z.object({
    memory: z.number().int().min(8192).max(262144),
    iterations: z.number().int().min(1).max(10),
    parallelism: z.number().int().min(1).max(8)
  })
});

export const loginSchema = z.object({
  username: z.string().min(1).max(80),
  authCredential: z.string().min(32).max(256)
});

export const recoverSchema = z.object({
  recoveryCredential: z.string().min(32).max(256),
  authCredential: z.string().min(32).max(256),
  authSalt: z.string().min(16).max(128),
  passwordEnvelope: envelope,
  kdfParams: setupSchema.shape.kdfParams
});

export const recordSchema = z.object({
  baseRevision: z.number().int().min(0),
  deleted: z.boolean().default(false),
  ciphertext: z.string().min(1).max(16 * 1024 * 1024)
});

export const blobInitSchema = z.object({
  id: z.string().uuid(),
  byteSize: z.number().int().positive(),
  chunkSize: z.number().int().min(64 * 1024).max(8 * 1024 * 1024),
  chunkCount: z.number().int().min(1).max(10000)
});

export const chunkSchema = z.object({
  iv: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(8 * 1024 * 1024)
});
