import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import { getAccount, prisma } from "./db.js";
import { corsMethods } from "./http.js";
import { blobInitSchema, chunkSchema, loginSchema, recoverSchema, recordSchema, setupSchema } from "./schemas.js";
import { newSessionToken, safeEqual, tokenHash, verifier } from "./security.js";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "test" ? "silent" : "info",
    redact: [
      "req.headers.authorization", "req.headers.cookie", "body.authCredential", "body.recoveryCredential",
      "body.ciphertext", "body.passwordEnvelope", "body.recoveryEnvelope"
    ]
  },
  trustProxy: config.TRUST_PROXY,
  bodyLimit: 17 * 1024 * 1024
});

await app.register(cookie);
await app.register(rateLimit, { global: false });
const frontendOrigin = config.FRONTEND_ORIGIN ? new URL(config.FRONTEND_ORIGIN).origin : undefined;
await app.register(cors, {
  origin: frontendOrigin ?? (config.NODE_ENV === "development" ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ : false),
  credentials: true,
  methods: corsMethods
});
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"], mediaSrc: ["'self'", "blob:"], connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"], objectSrc: ["'none'"], frameAncestors: ["'none'"]
    }
  }
});
if (config.NODE_ENV === "production" && config.SERVE_WEB && existsSync(config.webDistDir)) {
  await app.register(fastifyStatic, { root: config.webDistDir, prefix: "/" });
}

const cookieName = "nk_session";
const sessionDays = 14;
class RevisionConflict extends Error {}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function setSession(reply: FastifyReply): Promise<void> {
  const token = newSessionToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionDays * 86_400_000);
  await prisma.session.create({ data: { tokenHash: tokenHash(token), createdAt, expiresAt } });
  reply.setCookie(cookieName, token, {
    path: "/", httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "strict", expires: expiresAt
  });
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[cookieName];
  if (!token) return reply.code(401).send({ error: "Authentication required" });
  const hash = tokenHash(token);
  const session = await prisma.session.findUnique({ where: { tokenHash: hash } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { tokenHash: hash } });
    reply.clearCookie(cookieName, { path: "/" });
    return reply.code(401).send({ error: "Authentication required" });
  }
}

function verifyOrigin(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return done();
  const origin = request.headers.origin;
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = typeof forwardedHost === "string" ? forwardedHost : request.headers.host;
  if (origin && host) {
    try {
      if (frontendOrigin && new URL(origin).origin === frontendOrigin) return done();
      if (new URL(origin).host !== host) return void reply.code(403).send({ error: "Origin rejected" });
    } catch {
      return void reply.code(403).send({ error: "Origin rejected" });
    }
  }
  done();
}

app.addHook("onRequest", verifyOrigin);
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", issues: error.issues });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return reply.code(409).send({ error: "Already exists" });
  }
  const statusCode = typeof error === "object" && error && "statusCode" in error
    ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({ error: statusCode === 413 ? "Request is too large" : "Invalid request" });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "Unexpected server error" });
});

app.get("/health", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, database: "postgresql" };
  } catch {
    return reply.code(503).send({ ok: false, database: "unavailable" });
  }
});

app.get("/api/v1/bootstrap", async () => {
  const account = await getAccount();
  if (!account) return { initialized: false, limits: { maxFileBytes: config.MAX_FILE_BYTES, maxStorageBytes: config.MAX_STORAGE_BYTES } };
  return {
    initialized: true,
    username: account.username,
    authSalt: account.authSalt,
    passwordEnvelope: JSON.parse(account.passwordEnvelope),
    recoveryEnvelope: JSON.parse(account.recoveryEnvelope),
    kdfParams: JSON.parse(account.kdfParams),
    limits: { maxFileBytes: config.MAX_FILE_BYTES, maxStorageBytes: config.MAX_STORAGE_BYTES }
  };
});

app.post("/api/v1/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const input = setupSchema.parse(request.body);
  if (await getAccount()) return reply.code(409).send({ error: "Vault is already initialized" });
  await prisma.account.create({
    data: {
      id: 1, username: input.username, authVerifier: verifier(input.authCredential),
      recoveryVerifier: verifier(input.recoveryCredential), authSalt: input.authSalt,
      passwordEnvelope: JSON.stringify(input.passwordEnvelope), recoveryEnvelope: JSON.stringify(input.recoveryEnvelope),
      kdfParams: JSON.stringify(input.kdfParams)
    }
  });
  await setSession(reply);
  return reply.code(201).send({ ok: true });
});

app.post("/api/v1/auth/login", { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } }, async (request, reply) => {
  const input = loginSchema.parse(request.body);
  const account = await getAccount();
  const valid = account && input.username === account.username && safeEqual(verifier(input.authCredential), account.authVerifier);
  if (!valid) return reply.code(401).send({ error: "Invalid username or password" });
  await setSession(reply);
  return { ok: true };
});

app.post("/api/v1/auth/logout", async (request, reply) => {
  const token = request.cookies[cookieName];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  reply.clearCookie(cookieName, { path: "/" });
  return { ok: true };
});

app.post("/api/v1/auth/recover", { config: { rateLimit: { max: 4, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const input = recoverSchema.parse(request.body);
  const account = await getAccount();
  if (!account || !safeEqual(verifier(input.recoveryCredential), account.recoveryVerifier)) {
    return reply.code(401).send({ error: "Invalid recovery key" });
  }
  await prisma.$transaction([
    prisma.account.update({ where: { id: 1 }, data: {
      authVerifier: verifier(input.authCredential), authSalt: input.authSalt,
      passwordEnvelope: JSON.stringify(input.passwordEnvelope), kdfParams: JSON.stringify(input.kdfParams)
    } }),
    prisma.session.deleteMany()
  ]);
  await setSession(reply);
  return { ok: true };
});

app.post("/api/v1/auth/change-password", { preHandler: requireAuth }, async (request) => {
  const input = recoverSchema.omit({ recoveryCredential: true }).parse(request.body);
  const current = request.cookies[cookieName];
  await prisma.$transaction([
    prisma.account.update({ where: { id: 1 }, data: {
      authVerifier: verifier(input.authCredential), authSalt: input.authSalt,
      passwordEnvelope: JSON.stringify(input.passwordEnvelope), kdfParams: JSON.stringify(input.kdfParams)
    } }),
    prisma.session.deleteMany({ where: current ? { tokenHash: { not: tokenHash(current) } } : undefined })
  ]);
  return { ok: true };
});

app.get("/api/v1/sync/changes", { preHandler: requireAuth }, async (request) => {
  const query = request.query as { cursor?: string; limit?: string };
  const cursor = Math.max(0, Number.parseInt(query.cursor ?? "0", 10) || 0);
  const limit = Math.min(1000, Math.max(1, Number.parseInt(query.limit ?? "500", 10) || 500));
  const changes = await prisma.change.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take: limit });
  return {
    changes: changes.map((change) => ({
      seq: change.seq, id: change.recordId, revision: change.revision, deleted: change.deleted,
      ciphertext: change.ciphertext, changedAt: change.changedAt.toISOString()
    })),
    cursor: changes.at(-1)?.seq ?? cursor,
    hasMore: changes.length === limit
  };
});

app.put("/api/v1/records/:id", { preHandler: requireAuth }, async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!uuidPattern.test(id)) return reply.code(400).send({ error: "Invalid record id" });
  const input = recordSchema.parse(request.body);
  const revision = input.baseRevision + 1;
  const stamp = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.vaultRecord.findUnique({ where: { id }, select: { revision: true } });
      if ((current?.revision ?? 0) !== input.baseRevision) throw new RevisionConflict();
      if (current) {
        const updated = await tx.vaultRecord.updateMany({
          where: { id, revision: input.baseRevision },
          data: { revision, deleted: input.deleted, ciphertext: input.ciphertext, updatedAt: stamp }
        });
        if (updated.count !== 1) throw new RevisionConflict();
      } else {
        await tx.vaultRecord.create({ data: { id, revision, deleted: input.deleted, ciphertext: input.ciphertext, createdAt: stamp, updatedAt: stamp } });
      }
      await tx.recordRevision.create({ data: { recordId: id, revision, deleted: input.deleted, ciphertext: input.ciphertext, changedAt: stamp } });
      await tx.change.create({ data: { recordId: id, revision, deleted: input.deleted, ciphertext: input.ciphertext, changedAt: stamp } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const isRace = error instanceof RevisionConflict ||
      error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
    if (!isRace) throw error;
    const current = await prisma.vaultRecord.findUnique({ where: { id } });
    return reply.code(409).send({
      error: "Revision conflict",
      current: current ? { revision: current.revision, deleted: current.deleted, ciphertext: current.ciphertext, updatedAt: current.updatedAt.toISOString() } : null
    });
  }
  return { id, revision, changedAt: stamp.toISOString() };
});

app.get("/api/v1/records/:id/revisions", { preHandler: requireAuth }, async (request) => {
  const { id } = request.params as { id: string };
  const rows = await prisma.recordRevision.findMany({ where: { recordId: id }, orderBy: { revision: "desc" }, take: 30 });
  return { revisions: rows.map((row) => ({ ...row, changedAt: row.changedAt.toISOString() })) };
});

async function storageUsed(): Promise<bigint> {
  const result = await prisma.blobChunk.aggregate({ _sum: { byteSize: true } });
  return BigInt(result._sum.byteSize ?? 0);
}

app.get("/api/v1/quota", { preHandler: requireAuth }, async () => ({
  usedBytes: Number(await storageUsed()), maxStorageBytes: config.MAX_STORAGE_BYTES, maxFileBytes: config.MAX_FILE_BYTES
}));

app.post("/api/v1/blobs", { preHandler: requireAuth }, async (request, reply) => {
  const input = blobInitSchema.parse(request.body);
  if (input.byteSize > config.MAX_FILE_BYTES) return reply.code(413).send({ error: "File exceeds configured limit" });
  if (await storageUsed() + BigInt(input.byteSize) > BigInt(config.MAX_STORAGE_BYTES)) return reply.code(413).send({ error: "Vault storage quota exceeded" });
  await prisma.blob.create({ data: {
    id: input.id, byteSize: BigInt(input.byteSize), chunkSize: input.chunkSize, chunkCount: input.chunkCount
  } });
  mkdirSync(resolve(config.blobDir, input.id), { recursive: true });
  return reply.code(201).send({ ok: true });
});

app.put("/api/v1/blobs/:id/chunks/:index", { preHandler: requireAuth }, async (request, reply) => {
  const { id, index: rawIndex } = request.params as { id: string; index: string };
  const index = Number.parseInt(rawIndex, 10);
  if (!uuidPattern.test(id) || !Number.isInteger(index) || String(index) !== rawIndex) return reply.code(400).send({ error: "Invalid blob chunk" });
  const blob = await prisma.blob.findUnique({ where: { id } });
  if (!blob || blob.completed || index < 0 || index >= blob.chunkCount) return reply.code(404).send({ error: "Blob chunk rejected" });
  const input = chunkSchema.parse(request.body);
  // Store the encrypted envelope as opaque bytes. Sending the envelope directly
  // avoids wrapping a 4 MB chunk in base64 twice while preserving the existing
  // on-disk/download format (base64(JSON(envelope))).
  const bytes = Buffer.from(JSON.stringify(input), "utf8");
  writeFileSync(resolve(config.blobDir, id, `${index}.bin`), bytes, { mode: 0o600 });
  await prisma.blobChunk.upsert({
    where: { blobId_chunkIndex: { blobId: id, chunkIndex: index } },
    create: { blobId: id, chunkIndex: index, byteSize: bytes.byteLength },
    update: { byteSize: bytes.byteLength, createdAt: new Date() }
  });
  return { ok: true };
});

app.post("/api/v1/blobs/:id/complete", { preHandler: requireAuth }, async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!uuidPattern.test(id)) return reply.code(400).send({ error: "Invalid blob id" });
  const blob = await prisma.blob.findUnique({ where: { id }, include: { _count: { select: { chunks: true } } } });
  if (!blob || blob._count.chunks !== blob.chunkCount) return reply.code(409).send({ error: "Blob is incomplete" });
  await prisma.blob.update({ where: { id }, data: { completed: true } });
  return { ok: true };
});

app.get("/api/v1/blobs/:id/chunks/:index", { preHandler: requireAuth }, async (request, reply) => {
  const { id, index } = request.params as { id: string; index: string };
  const parsedIndex = Number.parseInt(index, 10);
  if (!uuidPattern.test(id) || !Number.isInteger(parsedIndex) || String(parsedIndex) !== index) return reply.code(400).send({ error: "Invalid blob chunk" });
  try {
    const bytes = readFileSync(resolve(config.blobDir, id, `${parsedIndex}.bin`));
    return { ciphertext: bytes.toString("base64") };
  } catch {
    return reply.code(404).send({ error: "Chunk not found" });
  }
});

app.delete("/api/v1/blobs/:id", { preHandler: requireAuth }, async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!uuidPattern.test(id)) return reply.code(400).send({ error: "Invalid blob id" });
  await prisma.blob.deleteMany({ where: { id } });
  rmSync(resolve(config.blobDir, id), { recursive: true, force: true });
  return { ok: true };
});

app.get("/api/v1/backup", { preHandler: requireAuth }, async () => {
  const [account, records, blobs] = await Promise.all([
    getAccount(), prisma.vaultRecord.findMany(), prisma.blob.findMany({ where: { completed: true } })
  ]);
  return {
    format: "nkriz-vault", version: 1, exportedAt: new Date().toISOString(),
    vault: account ? {
      authSalt: account.authSalt, passwordEnvelope: JSON.parse(account.passwordEnvelope),
      recoveryEnvelope: JSON.parse(account.recoveryEnvelope), kdfParams: JSON.parse(account.kdfParams)
    } : null,
    records: records.map((record) => ({ ...record, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() })),
    blobs: blobs.map((blob) => ({
      id: blob.id, byteSize: blob.byteSize.toString(), chunkSize: blob.chunkSize, chunkCount: blob.chunkCount,
      chunks: Array.from({ length: blob.chunkCount }, (_, index) => readFileSync(resolve(config.blobDir, blob.id, `${index}.bin`)).toString("base64"))
    }))
  };
});

app.get("/api/v1/storage/inspect", { preHandler: requireAuth }, async () => ({
  database: "postgresql", blobBytes: Number(await storageUsed()), plaintextFieldsStored: false
}));

if (config.NODE_ENV === "production" && config.SERVE_WEB && existsSync(config.webDistDir)) {
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url === "/health") return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const close = async () => { await app.close(); await prisma.$disconnect(); };
process.on("SIGTERM", close);
process.on("SIGINT", close);

if (process.env.NODE_ENV !== "test" || process.env.START_TEST_SERVER === "true") {
  await app.listen({ host: config.HOST, port: config.PORT });
}

export { app };
