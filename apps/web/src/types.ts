export type KdfParams = { memory: number; iterations: number; parallelism: number };
export type Envelope = { iv: string; ciphertext: string };

export type Bootstrap = {
  initialized: boolean;
  username?: string;
  authSalt?: string;
  passwordEnvelope?: Envelope;
  recoveryEnvelope?: Envelope;
  kdfParams?: KdfParams;
  limits: { maxFileBytes: number; maxStorageBytes: number };
};

export type ItemKind = "folder" | "note" | "secret" | "file" | "preferences";
export type NoteMode = "text" | "markdown" | "code";
export type SecretView = "simple" | "manager" | "multi";

export type PersistedDesktopWindow = {
  id: string;
  kind: "explorer" | "note" | "secret" | "file" | "passwords" | "settings";
  recordId?: string;
  folderId?: string | null;
  trash?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
};

export type EditorDesktopState = {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
  view?: "source" | "preview" | "split";
};

export type DesktopState = {
  windows: PersistedDesktopWindow[];
  iconPositions: Record<string, { x: number; y: number }>;
  iconSlots?: Record<string, number>;
  appSizes?: Partial<Record<PersistedDesktopWindow["kind"], { width: number; height: number }>>;
  usage?: Record<string, { count: number; lastOpened: string }>;
  editors: Record<string, EditorDesktopState>;
  searchQueries?: Record<string, string>;
};

export type DesktopWallpaper = {
  kind: "default" | "solid" | "gradient" | "image";
  value: string;
};

export type TagDefinition = { id: string; name: string; color: string };

export type BaseRecord = {
  id: string;
  kind: ItemKind;
  title: string;
  parentId: string | null;
  tags: string[];
  favorite: boolean;
  color?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type FolderRecord = BaseRecord & { kind: "folder" };
export type NoteRecord = BaseRecord & {
  kind: "note";
  mode: NoteMode;
  language?: string;
  content: string;
};
export type CustomSecretField = { id: string; label: string; value: string; concealed: boolean };
export type MultiPasswordEntry = { id: string; label: string; password: string };
export type SecretRecord = BaseRecord & {
  kind: "secret";
  view: SecretView;
  secretType: "password" | "api-key" | "jwt" | "token" | "other";
  username: string;
  password: string;
  urls: string[];
  notes: string;
  totpSecret: string;
  expiresAt: string;
  fields: CustomSecretField[];
  multiIntro?: string;
  multiEntries?: MultiPasswordEntry[];
  sourceNoteId?: string;
  sourceLine?: number;
};
export type MediaEdits = {
  rotation?: number;
  brightness?: number;
  contrast?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
  playbackRate?: number;
  loop?: boolean;
  trimStart?: number;
  trimEnd?: number;
};
export type FileRecord = BaseRecord & {
  kind: "file";
  mime: string;
  size: number;
  blobId: string;
  fileKey: string;
  chunkCount: number;
  chunkSize: number;
  sha256: string;
  thumbnail?: string;
  secretNote?: string;
  mediaEdits?: MediaEdits;
};
export type PreferencesRecord = BaseRecord & {
  kind: "preferences";
  theme: "light" | "dark" | "system";
  accent: string;
  editorFont: string;
  editorSize: number;
  lineWrap: boolean;
  tabSize: number;
  density: "comfortable" | "compact";
  sidebarWidth: number;
  autoLockMinutes: number;
  clipboardSeconds: number;
  defaultSecretView: SecretView;
  wallpaper?: DesktopWallpaper;
  tagDefinitions?: TagDefinition[];
  desktopState?: DesktopState;
};
export type VaultRecord = FolderRecord | NoteRecord | SecretRecord | FileRecord | PreferencesRecord;

export type EncryptedRecord = {
  id: string;
  revision: number;
  deleted: boolean;
  ciphertext: string;
  changedAt?: string;
};
