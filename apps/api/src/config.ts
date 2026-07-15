import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().default("./data"),
  DATABASE_URL: z.string().default("postgresql://nkriz:nkriz@127.0.0.1:5432/nkriz?schema=public"),
  SESSION_PEPPER: z.string().min(16).default("local-development-pepper-change-me"),
  COOKIE_SECURE: z.string().optional().transform((value) => value === "true"),
  TRUST_PROXY: z.string().optional().transform((value) => value === "true"),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  MAX_STORAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024 * 1024),
  WEB_DIST_DIR: z.string().optional(),
  FRONTEND_ORIGIN: z.string().url().optional(),
  SERVE_WEB: z.string().optional().transform((value) => value !== "false")
});

const parsed = schema.parse(process.env);
const dataDir = resolve(parsed.DATA_DIR);
mkdirSync(dataDir, { recursive: true });
mkdirSync(resolve(dataDir, "blobs"), { recursive: true });

export const config = {
  ...parsed,
  dataDir,
  blobDir: resolve(dataDir, "blobs"),
  webDistDir: parsed.WEB_DIST_DIR ? resolve(parsed.WEB_DIST_DIR) : resolve(process.cwd(), "apps/web/dist")
};
