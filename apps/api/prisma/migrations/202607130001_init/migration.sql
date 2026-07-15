CREATE TABLE "account" (
  "id" INTEGER NOT NULL,
  "username" VARCHAR(80) NOT NULL,
  "auth_verifier" VARCHAR(128) NOT NULL,
  "recovery_verifier" VARCHAR(128) NOT NULL,
  "auth_salt" VARCHAR(128) NOT NULL,
  "password_envelope" TEXT NOT NULL,
  "recovery_envelope" TEXT NOT NULL,
  "kdf_params" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "account_username_key" ON "account"("username");

CREATE TABLE "sessions" (
  "token_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

CREATE TABLE "records" (
  "id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "deleted" BOOLEAN NOT NULL DEFAULT false,
  "ciphertext" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "record_revisions" (
  "record_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "deleted" BOOLEAN NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "record_revisions_pkey" PRIMARY KEY ("record_id", "revision")
);
CREATE INDEX "record_revisions_record_id_revision_idx" ON "record_revisions"("record_id", "revision" DESC);

CREATE TABLE "changes" (
  "seq" SERIAL NOT NULL,
  "record_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "deleted" BOOLEAN NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "changes_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX "changes_seq_idx" ON "changes"("seq");

CREATE TABLE "blobs" (
  "id" UUID NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "chunk_size" INTEGER NOT NULL,
  "chunk_count" INTEGER NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "blobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blob_chunks" (
  "blob_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blob_chunks_pkey" PRIMARY KEY ("blob_id", "chunk_index")
);

ALTER TABLE "record_revisions" ADD CONSTRAINT "record_revisions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blob_chunks" ADD CONSTRAINT "blob_chunks_blob_id_fkey" FOREIGN KEY ("blob_id") REFERENCES "blobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
