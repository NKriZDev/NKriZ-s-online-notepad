import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow, Check, ChevronRight, Clipboard, ClipboardPaste, Cloud, CloudOff, Code2, Copy,
  File, FileImage, FileText, Folder, FolderOpen, Image, KeyRound, Lock, Maximize2, Minus,
  Layers3, Monitor, NotebookPen, Pencil, Plus, RefreshCw, RotateCcw, Scissors, Search, Settings,
  ShieldCheck, Star, Trash2, Upload, X
} from "lucide-react";
import { useVault } from "../hooks/useVault";
import { api } from "../lib/api";
import { cryptoClient } from "../lib/crypto-client";
import { reconcileTags, tagDefinitions } from "../lib/tags";
import type {
  DesktopState, EditorDesktopState, FileRecord, FolderRecord, NoteMode, NoteRecord,
  PersistedDesktopWindow, SecretRecord, VaultRecord
} from "../types";
import { FileViewer } from "./FileViewer";
import { NoteEditor } from "./NoteEditor";
import { PasswordManagerApp } from "./PasswordManagerApp";
import { SecretEditor } from "./SecretEditor";
import { SettingsApp } from "./SettingsDialog";

type WindowKind = PersistedDesktopWindow["kind"];
type DesktopWindow = PersistedDesktopWindow;
type WindowMotion = "opening" | "restoring" | "minimizing" | "closing";
type MarqueeRect = { left: number; top: number; width: number; height: number };
type RecordDragPayload = { ids: string[]; anchorId: string };
const RECORD_DRAG_TYPE = "application/x-nkriz-records";

function setRecordDragPayload(dataTransfer: DataTransfer, ids: string[], anchorId: string) {
  const uniqueIds = Array.from(new Set(ids));
  dataTransfer.setData(RECORD_DRAG_TYPE, JSON.stringify({ ids: uniqueIds, anchorId } satisfies RecordDragPayload));
  dataTransfer.setData("application/x-nkriz-record", anchorId);
  dataTransfer.effectAllowed = "move";
}

function getRecordDragPayload(dataTransfer: DataTransfer): RecordDragPayload | null {
  try {
    const raw = dataTransfer.getData(RECORD_DRAG_TYPE);
    if (raw) {
      const value = JSON.parse(raw) as Partial<RecordDragPayload>;
      if (Array.isArray(value.ids) && typeof value.anchorId === "string") {
        const ids = value.ids.filter((id): id is string => typeof id === "string");
        if (ids.length) return { ids: Array.from(new Set(ids)), anchorId: value.anchorId };
      }
    }
  } catch { /* fall back to the legacy single-record payload */ }
  const id = dataTransfer.getData("application/x-nkriz-record");
  return id ? { ids: [id], anchorId: id } : null;
}
type ContextTarget =
  | { kind: "desktop"; x: number; y: number; parentId: string | null }
  | { kind: "record"; x: number; y: number; recordId: string; parentId: string | null; selectionIds?: string[] }
  | { kind: "text"; x: number; y: number; editor?: boolean; convertSelection?: () => Promise<void> }
  | { kind: "window"; x: number; y: number; windowId: string }
  | { kind: "recents"; x: number; y: number; recordKind: "note" | "secret" | "folder" };

const emptyDesktopState = (): DesktopState => ({ windows: [], iconPositions: {}, iconSlots: {}, appSizes: {}, usage: {}, editors: {}, searchQueries: {} });

function recordIcon(record: VaultRecord, size = 32, desktop = false) {
  const color = desktop ? "#f3f6f8" : record.kind === "folder" ? "#b3892f" : record.kind === "secret" ? "#9b7a31" : "#52748f";
  const props = { size, color, strokeWidth: 1.45 };
  if (record.kind === "folder") return <Folder {...props} />;
  if (record.kind === "secret") return <KeyRound {...props} />;
  if (record.kind === "file" && record.thumbnail) return <img className="record-thumbnail" src={record.thumbnail} alt="" />;
  if (record.kind === "file" && record.mime.startsWith("image/")) return <FileImage {...props} />;
  if (record.kind === "file") return <File {...props} />;
  if (record.kind === "note" && record.mode === "code") return <Code2 {...props} />;
  return <FileText {...props} />;
}

function windowIcon(kind: WindowKind, size = 16) {
  const props = { size, strokeWidth: 1.55 };
  if (kind === "explorer") return <FolderOpen {...props} color="#b3892f" />;
  if (kind === "passwords") return <KeyRound {...props} color="#9b7a31" />;
  if (kind === "settings") return <Settings {...props} color="#607487" />;
  if (kind === "secret") return <KeyRound {...props} color="#9b7a31" />;
  if (kind === "file") return <FileImage {...props} color="#52748f" />;
  return <NotebookPen {...props} color="#3f7298" />;
}

function gridPosition(index: number) {
  const rows = Math.max(1, Math.floor((window.innerHeight - 70) / 92));
  return { x: 10 + Math.floor(index / rows) * 90, y: 10 + index % rows * 92 };
}

async function createMediaThumbnail(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return undefined;
  const objectUrl = URL.createObjectURL(file);
  try {
    const media = file.type.startsWith("image/") ? document.createElement("img") : document.createElement("video");
    media.src = objectUrl;
    if (media instanceof HTMLVideoElement) { media.muted = true; media.playsInline = true; }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Thumbnail timed out")), 5000);
      const ready = () => { window.clearTimeout(timer); resolve(); };
      media.addEventListener(media instanceof HTMLVideoElement ? "loadeddata" : "load", ready, { once: true });
      media.addEventListener("error", () => reject(new Error("Thumbnail unavailable")), { once: true });
    });
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = 180; canvas.height = 112;
    const context = canvas.getContext("2d");
    if (!context || !width || !height) return undefined;
    const scale = Math.max(canvas.width / width, canvas.height / height);
    const drawWidth = width * scale; const drawHeight = height * scale;
    context.drawImage(media, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    return canvas.toDataURL("image/jpeg", .72);
  } catch { return undefined; }
  finally { URL.revokeObjectURL(objectUrl); }
}

function DesktopIcon({ id, label, icon, slot, selected, onSelect, onOpen, onDragRecords, onDropRecords, onContextMenu }: {
  id: string;
  label: string;
  icon: React.ReactNode;
  slot: number;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onDragRecords: (event: React.DragEvent, id: string) => void;
  onDropRecords: (payload: RecordDragPayload) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const position = gridPosition(slot);
  return <button
    data-desktop-id={id}
    data-selection-id={id}
    className={`pc-desktop-icon ${selected ? "selected" : ""}`}
    style={{ left: position.x, top: position.y }}
    draggable
    onDragStart={(event) => onDragRecords(event, id)}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload && (payload.ids.length > 1 || payload.anchorId !== id)) onDropRecords(payload); }}
    onClick={(event) => { event.stopPropagation(); onSelect(event); }}
    onDoubleClick={(event) => { event.stopPropagation(); onOpen(); }}
    onContextMenu={onContextMenu}
  >
    <span className="pc-icon-picture">{icon}</span>
    <span>{label}</span>
  </button>;
}

function WindowFrame({ window: item, title, active, motion, onFocus, onGeometry, onMinimize, onMaximize, onClose, onContextMenu, children }: {
  window: DesktopWindow;
  title: string;
  active: boolean;
  motion?: WindowMotion;
  onFocus: () => void;
  onGeometry: (patch: Partial<DesktopWindow>) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const [interacting, setInteracting] = useState(false);
  if (item.minimized) return null;
  const moveWindow = (event: React.PointerEvent<HTMLDivElement>) => {
    if (item.maximized || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    onFocus();
    setInteracting(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = item.x;
    const originY = item.y;
    const move = (next: PointerEvent) => onGeometry({
      x: Math.max(0, Math.min(window.innerWidth - 120, originX + next.clientX - startX)),
      y: Math.max(0, Math.min(window.innerHeight - 78, originY + next.clientY - startY))
    });
    const up = () => { setInteracting(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resizeWindow = (edge: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (item.maximized) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus();
    setInteracting(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: item.x, y: item.y, width: item.width, height: item.height };
    const move = (next: PointerEvent) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      let { x, y, width, height } = origin;
      if (edge.includes("e")) width = Math.max(360, origin.width + dx);
      if (edge.includes("s")) height = Math.max(240, origin.height + dy);
      if (edge.includes("w")) { width = Math.max(360, origin.width - dx); x = origin.x + origin.width - width; }
      if (edge.includes("n")) { height = Math.max(240, origin.height - dy); y = origin.y + origin.height - height; }
      width = Math.min(width, window.innerWidth - Math.max(0, x));
      height = Math.min(height, window.innerHeight - 48 - Math.max(0, y));
      onGeometry({ x: Math.max(0, x), y: Math.max(0, y), width, height });
    };
    const up = () => { setInteracting(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const style = item.maximized
    ? { left: 0, top: 0, right: 0, bottom: 48, width: "auto", height: "auto", zIndex: item.z }
    : { left: item.x, top: item.y, right: "auto", bottom: "auto", width: item.width, height: item.height, zIndex: item.z };
  return <section data-window-id={item.id} className={`pc-window ${active ? "active" : ""} ${item.maximized ? "maximized" : ""} ${interacting ? "interacting" : ""} ${motion ? `pc-window-${motion}` : ""}`} style={style} onPointerDown={onFocus} onContextMenu={onContextMenu}>
    <div className="pc-window-titlebar" onPointerDown={moveWindow} onDoubleClick={onMaximize}>
      <div>{windowIcon(item.kind)}<span>{title}</span></div>
      <div className="pc-window-controls">
        <button title="Minimize" onClick={onMinimize}><Minus size={15} /></button>
        <button title={item.maximized ? "Restore" : "Maximize"} onClick={onMaximize}><Maximize2 size={13} /></button>
        <button className="close" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    <div className="pc-window-body">{children}</div>
    {!item.maximized && ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((edge) => <div key={edge} className={`pc-resize-handle ${edge}`} onPointerDown={(event) => resizeWindow(edge, event)} />)}
  </section>;
}

export function VaultShell({ onLock }: { onLock: () => void }) {
  const vault = useVault(onLock);
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const windowsRef = useRef<DesktopWindow[]>([]);
  const [motions, setMotions] = useState<Record<string, WindowMotion>>({});
  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [iconSlots, setIconSlots] = useState<Record<string, number>>({ "this-vault": 0, trash: 1, "password-manager": 2 });
  const [appSizes, setAppSizes] = useState<NonNullable<DesktopState["appSizes"]>>({});
  const [usage, setUsage] = useState<NonNullable<DesktopState["usage"]>>({});
  const [editorStates, setEditorStates] = useState<Record<string, EditorDesktopState>>({});
  const [selectedIcons, setSelectedIcons] = useState<string[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<Record<string, string[]>>({});
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startSearch, setStartSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextTarget | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{ recordId: string; cut: boolean } | null>(null);
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(new Date());
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const desktopIconsRef = useRef<HTMLElement>(null);
  const suppressNextDesktopClick = useRef(false);
  const uploadParent = useRef<string | null>(null);
  const zCounter = useRef(10);
  const launchOffset = useRef(0);
  const restored = useRef(false);
  const lastPersisted = useRef("");
  const desktopSnapshotRef = useRef<DesktopState>(emptyDesktopState());
  const preferencesRef = useRef(vault.preferences);
  preferencesRef.current = vault.preferences;
  desktopSnapshotRef.current = { windows, iconPositions, iconSlots, appSizes, usage, editors: editorStates, searchQueries };

  const selectOne = (id: string, event: React.MouseEvent, current: string[], apply: (ids: string[]) => void) => {
    if (event.ctrlKey || event.metaKey) apply(current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
    else apply([id]);
  };
  const beginMarquee = (event: React.PointerEvent, container: HTMLElement, current: string[], apply: (ids: string[]) => void) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    const bounds = container.getBoundingClientRect();
    const clampX = (value: number) => Math.max(bounds.left, Math.min(bounds.right, value));
    const clampY = (value: number) => Math.max(bounds.top, Math.min(bounds.bottom, value));
    const startX = clampX(event.clientX);
    const startY = clampY(event.clientY);
    const additive = event.ctrlKey || event.metaKey;
    const base = additive ? [...current] : [];
    let dragged = false;
    if (!additive) apply([]);
    setContextMenu(null);
    setStartOpen(false);

    const move = (next: PointerEvent) => {
      const endX = clampX(next.clientX);
      const endY = clampY(next.clientY);
      if (Math.abs(endX - startX) > 3 || Math.abs(endY - startY) > 3) dragged = true;
      const rect = { left: Math.min(startX, endX), top: Math.min(startY, endY), width: Math.abs(endX - startX), height: Math.abs(endY - startY) };
      setMarquee(rect);
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const hits = Array.from(container.querySelectorAll<HTMLElement>("[data-selection-id]")).filter((element) => {
        const item = element.getBoundingClientRect();
        return item.right >= rect.left && item.left <= right && item.bottom >= rect.top && item.top <= bottom;
      }).map((element) => element.dataset.selectionId).filter((id): id is string => Boolean(id));
      apply(additive ? Array.from(new Set([...base, ...hits])) : hits);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (dragged) suppressNextDesktopClick.current = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const commitWindows = useCallback((updater: (current: DesktopWindow[]) => DesktopWindow[]) => {
    setWindows((current) => {
      const next = updater(current);
      windowsRef.current = next;
      return next;
    });
  }, []);
  const persistDesktop = useCallback(() => {
    if (!vault.ready || !restored.current) return;
    const state = desktopSnapshotRef.current;
    const serialized = JSON.stringify(state);
    if (serialized === lastPersisted.current) return;
    lastPersisted.current = serialized;
    void vault.saveRecord({ ...preferencesRef.current, desktopState: state }).catch(() => {
      if (lastPersisted.current === serialized) lastPersisted.current = "";
    });
  }, [vault.ready, vault.saveRecord]);
  const animateWindow = useCallback((id: string, motion: WindowMotion, duration = 180) => {
    setMotions((current) => ({ ...current, [id]: motion }));
    window.setTimeout(() => setMotions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    }), duration);
  }, []);

  useEffect(() => { void vault.initialize(); }, [vault.initialize]);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!vault.ready || restored.current) return;
    const state = vault.preferences.desktopState ?? emptyDesktopState();
    const validWindows = state.windows.filter((item) => ["explorer", "passwords", "settings"].includes(item.kind) || vault.records.some((record) => record.id === item.recordId)).map((item) => ({
      ...item,
      x: Math.max(0, Math.min(item.x, window.innerWidth - 120)),
      y: Math.max(0, Math.min(item.y, window.innerHeight - 78)),
      width: Math.min(item.width, window.innerWidth - Math.max(0, Math.min(item.x, window.innerWidth - 120))),
      height: Math.min(item.height, window.innerHeight - 48 - Math.max(0, Math.min(item.y, window.innerHeight - 78)))
    }));
    windowsRef.current = validWindows;
    setWindows(validWindows);
    setIconPositions(state.iconPositions ?? {});
    setIconSlots({ "this-vault": 0, trash: 1, "password-manager": 2, ...(state.iconSlots ?? {}) });
    setAppSizes(state.appSizes ?? {});
    setUsage(state.usage ?? {});
    setEditorStates(state.editors ?? {});
    setSearchQueries(state.searchQueries ?? {});
    zCounter.current = Math.max(10, ...validWindows.map((item) => item.z));
    lastPersisted.current = JSON.stringify({ windows: validWindows, iconPositions: state.iconPositions ?? {}, iconSlots: { "this-vault": 0, trash: 1, "password-manager": 2, ...(state.iconSlots ?? {}) }, appSizes: state.appSizes ?? {}, usage: state.usage ?? {}, editors: state.editors ?? {}, searchQueries: state.searchQueries ?? {} });
    restored.current = true;
  }, [vault.preferences.desktopState, vault.ready, vault.records]);
  useEffect(() => {
    if (!vault.ready || !restored.current) return;
    const timer = window.setTimeout(persistDesktop, 300);
    return () => window.clearTimeout(timer);
  }, [appSizes, editorStates, iconPositions, iconSlots, persistDesktop, searchQueries, usage, vault.ready, windows]);
  useEffect(() => {
    const pageHide = () => persistDesktop();
    const visibility = () => { if (document.visibilityState === "hidden") persistDesktop(); };
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", pageHide); document.removeEventListener("visibilitychange", visibility); };
  }, [persistDesktop]);
  useEffect(() => {
    let timer = 0;
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(onLock, Math.max(1, vault.preferences.autoLockMinutes) * 60_000); };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => { window.clearTimeout(timer); events.forEach((event) => window.removeEventListener(event, reset)); };
  }, [onLock, vault.preferences.autoLockMinutes]);

  const focusWindow = useCallback((id: string) => {
    const previous = windowsRef.current.find((item) => item.id === id);
    const z = ++zCounter.current;
    if (previous?.minimized) animateWindow(id, "restoring");
    commitWindows((current) => current.map((item) => item.id === id ? { ...item, z, minimized: false } : item));
  }, [animateWindow, commitWindows]);
  const openWindow = useCallback((kind: WindowKind, options: Partial<DesktopWindow> = {}) => {
    const key = kind === "passwords" || kind === "settings" ? `app:${kind}` : options.recordId ? `${kind}:${options.recordId}` : options.trash ? "explorer:trash" : `explorer:${options.folderId ?? "root"}`;
    const existing = windowsRef.current.find((item) => item.id === key);
    if (existing) { focusWindow(key); return; }
    const offset = launchOffset.current++ % 7;
    const z = ++zCounter.current;
    const remembered = desktopSnapshotRef.current.appSizes?.[kind];
    const firstSize = kind === "settings" ? { width: 760, height: 650 } : kind === "passwords" ? { width: 820, height: 620 } : kind === "explorer" ? { width: 760, height: 620 } : kind === "secret" ? { width: 850, height: 660 } : { width: 850, height: 620 };
    const x = 110 + offset * 28;
    const y = 52 + offset * 24;
    const next: DesktopWindow = {
      id: key, kind, x, y,
      width: Math.max(360, Math.min(remembered?.width ?? firstSize.width, window.innerWidth - x)),
      height: Math.max(240, Math.min(remembered?.height ?? firstSize.height, window.innerHeight - 48 - y)),
      z, minimized: false, maximized: false, ...options
    };
    commitWindows((current) => [...current, next]);
    animateWindow(key, "opening");
  }, [animateWindow, commitWindows, focusWindow]);
  const closeWindow = (id: string) => {
    const target = windowsRef.current.find((item) => item.id === id);
    if (target) setAppSizes((current) => ({ ...current, [target.kind]: { width: target.width, height: target.height } }));
    animateWindow(id, "closing", 150);
    window.setTimeout(() => commitWindows((current) => current.filter((item) => item.id !== id)), 145);
  };
  const minimizeWindow = (id: string) => {
    animateWindow(id, "minimizing", 160);
    window.setTimeout(() => commitWindows((current) => current.map((item) => item.id === id ? { ...item, minimized: true } : item)), 150);
  };
  const changeWindow = (id: string, patch: Partial<DesktopWindow>) => commitWindows((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const openRecord = useCallback((record: VaultRecord) => {
    setUsage((current) => ({ ...current, [record.id]: { count: (current[record.id]?.count ?? 0) + 1, lastOpened: new Date().toISOString() } }));
    if (record.kind === "folder") openWindow("explorer", { folderId: record.id });
    else if (record.kind === "note") openWindow("note", { recordId: record.id });
    else if (record.kind === "secret") openWindow("secret", { recordId: record.id });
    else if (record.kind === "file") openWindow("file", { recordId: record.id });
  }, [openWindow]);

  const createBase = (kind: VaultRecord["kind"], title: string, parentId: string | null = null) => {
    const stamp = new Date().toISOString();
    return { id: crypto.randomUUID(), kind, title, parentId, tags: [], favorite: false, createdAt: stamp, updatedAt: stamp };
  };
  const createNote = async (mode: NoteMode = "text", parentId: string | null = null) => {
    const record: NoteRecord = { ...createBase("note", mode === "markdown" ? "Untitled.md" : mode === "code" ? "Untitled code" : "Untitled note", parentId), kind: "note", mode, content: "", language: mode === "code" ? "javascript" : undefined };
    await vault.saveRecord(record); openRecord(record); setStartOpen(false);
  };
  const createSecret = async (view: "manager" | "multi" = "manager", parentId: string | null = null) => {
    const record: SecretRecord = { ...createBase("secret", view === "multi" ? "New multi-password" : "New password", parentId), kind: "secret", view, secretType: "password", username: "", password: "", urls: [], notes: "", totpSecret: "", expiresAt: "", fields: [], multiIntro: "", multiEntries: [] };
    await vault.saveRecord(record); openRecord(record); setStartOpen(false);
  };
  const createInlineSecret = async ({ id, value, noteId, noteTitle, line }: { id: string; value: string; noteId: string; noteTitle: string; line: number }) => {
    const record: SecretRecord = {
      ...createBase("secret", `${noteTitle} — line ${line}`), id, kind: "secret", view: "manager", secretType: "password",
      username: "", password: value, urls: [], notes: "Created from an inline Notepad password.", totpSecret: "", expiresAt: "", fields: [],
      multiIntro: "", multiEntries: [], sourceNoteId: noteId, sourceLine: line
    };
    await vault.saveRecord(record);
  };
  const createFolder = async (parentId: string | null = null) => {
    const title = window.prompt("Folder name", "New folder")?.trim();
    if (!title) return;
    const record: FolderRecord = { ...createBase("folder", title, parentId), kind: "folder", color: "#b89545" };
    await vault.saveRecord(record); setStartOpen(false);
  };
  const uploadFiles = async (files: FileList | null, parentId: string | null = null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        setUploadProgress(0);
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const editable = file.size <= 5 * 1024 * 1024 && (file.type.startsWith("text/") || ["md", "txt", "json", "js", "jsx", "ts", "tsx", "py", "css", "html", "xml", "yaml", "yml", "toml", "sh", "sql", "env", "log"].includes(extension));
        if (editable) {
          const stamp = new Date().toISOString();
          const languageMap: Record<string, string> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", json: "json" };
          const record: NoteRecord = { id: crypto.randomUUID(), kind: "note", title: file.name, parentId, tags: [], favorite: false, createdAt: stamp, updatedAt: stamp, content: await file.text(), mode: extension === "md" ? "markdown" : extension === "txt" ? "text" : "code", language: languageMap[extension] ?? "text" };
          await vault.saveRecord(record); openRecord(record);
        } else {
          let record = await vault.uploadFile(file, parentId, setUploadProgress);
          const thumbnail = await createMediaThumbnail(file);
          if (thumbnail) record = await vault.saveRecord({ ...record, thumbnail }) as FileRecord;
          openRecord(record);
        }
      } catch (error) { window.alert(error instanceof Error ? error.message : "Upload failed"); }
      finally { setUploadProgress(null); }
    }
  };
  const chooseFiles = (parentId: string | null = null) => { uploadParent.current = parentId; fileInput.current?.click(); };

  const desktopRecords = useMemo(() => vault.records.filter((record) => !["preferences", "secret"].includes(record.kind) && !record.parentId && !record.deletedAt), [vault.records]);
  const passwordRecords = useMemo(() => vault.records.filter((record): record is SecretRecord => record.kind === "secret"), [vault.records]);
  const configuredTags = useMemo(() => tagDefinitions(vault.preferences.tagDefinitions), [vault.preferences.tagDefinitions]);
  useEffect(() => {
    if (!vault.ready) return;
    setIconSlots((current) => {
      const next: Record<string, number> = { ...current, "this-vault": 0, trash: 1, "password-manager": 2 };
      const occupied = new Set<number>([0, 1, 2]);
      const unplaced: string[] = [];

      // Retain every visible icon's valid position. Slots owned only by deleted
      // or moved items are deliberately ignored, so the next new desktop item
      // fills the earliest gap just like Windows auto-arrange.
      for (const record of desktopRecords) {
        const slot = next[record.id];
        if (typeof slot === "number" && Number.isInteger(slot) && slot >= 0 && !occupied.has(slot)) occupied.add(slot);
        else unplaced.push(record.id);
      }
      for (const id of unplaced) {
        let slot = 0;
        while (occupied.has(slot)) slot++;
        next[id] = slot;
        occupied.add(slot);
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [desktopRecords, vault.ready]);
  const placeIcon = (id: string, slot: number) => setIconSlots((current) => {
    const occupied = Object.entries(current).find(([otherId, otherSlot]) => otherId !== id && otherSlot === slot);
    const next = { ...current, [id]: slot };
    if (occupied) {
      if (current[id] !== undefined) next[occupied[0]] = current[id];
      else {
        const used = new Set(Object.values(current));
        let empty = 0;
        while (used.has(empty)) empty++;
        next[occupied[0]] = empty;
      }
    }
    return next;
  });
  const placeIcons = (ids: string[], anchorId: string, targetSlot: number) => {
    const moving = Array.from(new Set(ids)).filter((id) => vault.records.some((record) => record.id === id && record.kind !== "preferences" && !record.deletedAt));
    if (moving.length <= 1) {
      if (moving[0]) placeIcon(moving[0], targetSlot);
      return;
    }
    setIconSlots((current) => {
    const anchorSlot = current[anchorId];
    const safeTarget = Math.max(3, targetSlot);
    const desired = new Map<string, number>();
    if (typeof anchorSlot === "number") {
      const delta = safeTarget - anchorSlot;
      const minimum = Math.min(...moving.map((id) => (current[id] ?? anchorSlot) + delta));
      const correction = minimum < 3 ? 3 - minimum : 0;
      moving.forEach((id) => desired.set(id, (current[id] ?? anchorSlot) + delta + correction));
    } else {
      moving.forEach((id, index) => desired.set(id, safeTarget + index));
    }

    const next = { ...current };
    const movingSet = new Set(moving);
    const desiredSlots = new Set(desired.values());
    const displaced = Object.entries(current).filter(([id, slot]) => !movingSet.has(id) && desiredSlots.has(slot));
    const reserved = new Set(Object.entries(current).filter(([id]) => !movingSet.has(id) && !displaced.some(([other]) => other === id)).map(([, slot]) => slot));
    desiredSlots.forEach((slot) => reserved.add(slot));
    const vacated = moving.map((id) => current[id]).filter((slot): slot is number => typeof slot === "number" && slot >= 3 && !reserved.has(slot));
    for (const [id] of displaced) {
      let slot = vacated.shift();
      if (slot === undefined) { slot = 3; while (reserved.has(slot)) slot++; }
      next[id] = slot;
      reserved.add(slot);
    }
    desired.forEach((slot, id) => { next[id] = slot; });
    return next;
    });
  };
  const slotAtPoint = (x: number, y: number) => {
    const rows = Math.max(1, Math.floor((window.innerHeight - 70) / 92));
    const column = Math.max(0, Math.round((x - 51) / 90));
    const row = Math.max(0, Math.min(rows - 1, Math.round((y - 54) / 92)));
    return column * rows + row;
  };
  const moveRecordTo = async (recordId: string, parentId: string | null) => {
    const record = vault.records.find((entry) => entry.id === recordId);
    if (!record || record.kind === "preferences" || record.id === parentId) return;
    if (parentId) {
      const parent = vault.records.find((entry) => entry.id === parentId);
      if (parent?.kind !== "folder") return;
      let ancestor: VaultRecord | undefined = parent;
      while (ancestor) {
        if (ancestor.id === recordId) return;
        ancestor = ancestor.parentId ? vault.records.find((entry) => entry.id === ancestor?.parentId) : undefined;
      }
    }
    await vault.saveRecord({ ...record, parentId } as VaultRecord);
  };
  const recordIds = (ids: string[]) => Array.from(new Set(ids)).filter((id) => vault.records.some((record) => record.id === id && record.kind !== "preferences"));
  const moveRecordsTo = async (ids: string[], parentId: string | null) => {
    await Promise.all(recordIds(ids).map((id) => moveRecordTo(id, parentId)));
  };
  const trashRecords = async (ids: string[]) => {
    await Promise.all(recordIds(ids).map(async (id) => {
      const record = vault.records.find((entry) => entry.id === id);
      if (record && !record.deletedAt) await vault.softDelete(record);
    }));
    setSelectedIcons((current) => current.filter((id) => !ids.includes(id)));
    setSelectedRecords((current) => Object.fromEntries(Object.entries(current).map(([windowId, selected]) => [windowId, selected.filter((id) => !ids.includes(id))])));
  };
  const emptyRecycleBin = async () => {
    const trashed = vault.records.filter((record) => record.kind !== "preferences" && Boolean(record.deletedAt));
    if (!trashed.length) return;
    if (!window.confirm(`Permanently delete ${trashed.length} item${trashed.length === 1 ? "" : "s"} from the Recycle Bin?`)) return;
    if (!window.confirm("Final confirmation: this cannot be undone. Empty the Recycle Bin now?")) return;
    const ids = new Set(trashed.map((record) => record.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of vault.records) {
        if (record.kind !== "preferences" && record.parentId && ids.has(record.parentId) && !ids.has(record.id)) {
          ids.add(record.id);
          changed = true;
        }
      }
    }
    await Promise.all(vault.records.filter((record) => ids.has(record.id)).map((record) => vault.permanentlyDelete(record)));
    await vault.sync();
    setSelectedIcons((current) => current.filter((id) => !ids.has(id)));
    setSelectedRecords((current) => Object.fromEntries(Object.entries(current).map(([windowId, selected]) => [windowId, selected.filter((id) => !ids.has(id))])));
  };
  const startDesktopDrag = (event: React.DragEvent, id: string) => {
    const ids = selectedIcons.includes(id) ? selectedIcons : [id];
    if (!selectedIcons.includes(id)) setSelectedIcons([id]);
    const draggableIds = recordIds(ids);
    if (!draggableIds.includes(id)) { event.preventDefault(); return; }
    setRecordDragPayload(event.dataTransfer, draggableIds, id);
  };
  const activeWindow = windows.filter((item) => !item.minimized).sort((a, b) => b.z - a.z)[0];
  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], .cm-editor")) return;
      const explorerSelection = activeWindow?.kind === "explorer" ? selectedRecords[activeWindow.id] ?? [] : [];
      const ids = explorerSelection.length ? explorerSelection : selectedIcons;
      const deletable = recordIds(ids);
      if (!deletable.length) return;
      event.preventDefault();
      void trashRecords(deletable);
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [activeWindow?.id, activeWindow?.kind, selectedIcons, selectedRecords, vault.records]);
  const quickAccess = vault.records.filter((record) => record.kind !== "preferences" && !record.deletedAt && usage[record.id]).sort((a, b) => (usage[b.id]?.count ?? 0) - (usage[a.id]?.count ?? 0) || (usage[b.id]?.lastOpened ?? "").localeCompare(usage[a.id]?.lastOpened ?? "")).slice(0, 5);
  const save = useCallback((record: VaultRecord) => { void vault.saveRecord(record); }, [vault.saveRecord]);
  const saveSettings = async (next: typeof vault.preferences) => {
    const previousDefinitions = tagDefinitions(vault.preferences.tagDefinitions);
    const nextDefinitions = tagDefinitions(next.tagDefinitions);
    const previousByName = new Map(previousDefinitions.map((tag) => [tag.name, tag]));
    const updates = vault.records.flatMap((record) => {
      if (record.kind === "preferences" || !record.tags.some((name) => previousByName.has(name))) return [];
      const tags = reconcileTags(record.tags, previousDefinitions, nextDefinitions);
      return [vault.saveRecord({ ...record, tags } as VaultRecord)];
    });
    await vault.saveRecord({ ...next, tagDefinitions: nextDefinitions });
    await Promise.all(updates);
    await vault.sync();
  };
  const titleFor = (item: DesktopWindow) => {
    if (item.trash) return "Recycle Bin";
    if (item.kind === "passwords") return "Password Manager";
    if (item.kind === "settings") return "Settings";
    if (item.kind === "explorer") return item.folderId ? vault.records.find((record) => record.id === item.folderId)?.title ?? "File Explorer" : "This Vault";
    return vault.records.find((record) => record.id === item.recordId)?.title ?? (item.kind === "note" ? "Notepad" : item.kind === "secret" ? "Secrets" : "File Viewer");
  };
  const changePassword = async (password: string) => { const bundle = await cryptoClient.rewrapPassword(password); await api.changePassword(bundle); };
  const searchableText = (record: VaultRecord) => {
    const common = [record.title, ...record.tags].join(" ");
    if (record.kind === "note") return `${common} ${record.content} ${record.language ?? ""}`;
    if (record.kind === "secret") return `${common} ${record.username} ${record.urls.join(" ")} ${record.notes} ${record.multiIntro ?? ""} ${(record.multiEntries ?? []).map((entry) => entry.label).join(" ")} ${record.secretType} ${record.fields.map((field) => field.label).join(" ")}`;
    if (record.kind === "file") return `${common} ${record.mime} ${record.secretNote ?? ""}`;
    return common;
  };
  const searchRecords = (query: string) => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) return [];
    return vault.records.filter((record) => record.kind !== "preferences" && !record.deletedAt && searchableText(record).toLocaleLowerCase().includes(value));
  };

  const renameRecord = async (record: VaultRecord) => {
    const title = window.prompt("Rename", record.title)?.trim();
    if (title && title !== record.title) await vault.saveRecord({ ...record, title } as VaultRecord);
  };
  const pasteInto = async (parentId: string | null) => {
    if (!fileClipboard) return;
    const source = vault.records.find((record) => record.id === fileClipboard.recordId);
    if (!source || source.kind === "preferences") return;
    if (fileClipboard.cut) {
      await vault.saveRecord({ ...source, parentId } as VaultRecord);
      setFileClipboard(null);
      return;
    }
    const stamp = new Date().toISOString();
    const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} - Copy`, parentId, createdAt: stamp, updatedAt: stamp } as VaultRecord;
    await vault.saveRecord(copy);
  };
  const runTextCommand = async (command: "cut" | "copy" | "paste" | "selectAll") => {
    if (command === "paste") {
      try { document.execCommand("insertText", false, await navigator.clipboard.readText()); } catch { /* permission unavailable */ }
    } else document.execCommand(command);
    setContextMenu(null);
  };
  const openContext = (event: React.MouseEvent, target: ContextTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(target);
    setStartOpen(false);
  };

  const explorerContent = (item: DesktopWindow) => {
    const folderId = item.folderId ?? null;
    const query = searchQueries[item.id] ?? "";
    const content = query.trim()
      ? vault.records.filter((record) => record.kind !== "preferences" && (item.trash ? Boolean(record.deletedAt) : !record.deletedAt) && searchableText(record).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      : vault.records.filter((record) => record.kind !== "preferences" && (item.trash ? Boolean(record.deletedAt) : !record.deletedAt && record.parentId === folderId));
    const folder = folderId ? vault.records.find((record) => record.id === folderId) : undefined;
    const windowSelection = selectedRecords[item.id] ?? [];
    const applyWindowSelection = (ids: string[]) => setSelectedRecords((current) => ({ ...current, [item.id]: ids }));
    return <div className="pc-explorer">
      <div className="pc-explorer-toolbar">
        <button title="Back" onClick={() => changeWindow(item.id, { folderId: folder?.parentId ?? null, trash: false })}>←</button>
        <div className="pc-address"><Monitor size={14} strokeWidth={1.5} /><ChevronRight size={13} /><span>{query ? "Search results" : item.trash ? "Recycle Bin" : folder?.title ?? "This Vault"}</span></div>
        <label className="pc-explorer-search"><Search size={14} /><input aria-label="Search vault" placeholder="Search vault" value={query} onChange={(event) => setSearchQueries((current) => ({ ...current, [item.id]: event.target.value }))} />{query && <button title="Clear search" onClick={() => setSearchQueries((current) => ({ ...current, [item.id]: "" }))}><X size={13} /></button>}</label>
      </div>
      <div className="pc-explorer-main">
        <aside>
          <button onClick={() => changeWindow(item.id, { folderId: null, trash: false })}><Monitor size={16} strokeWidth={1.5} />Desktop</button>
          <button onClick={() => changeWindow(item.id, { trash: true })}><Trash2 size={16} strokeWidth={1.5} />Recycle Bin</button>
          <strong>Folders</strong>
          {vault.records.filter((record): record is FolderRecord => record.kind === "folder" && !record.deletedAt).map((record) => <button key={record.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload) void moveRecordsTo(payload.ids, record.id); }} onClick={() => changeWindow(item.id, { folderId: record.id, trash: false })}><Folder size={16} color={record.color} strokeWidth={1.5} />{record.title}{record.tags.length > 0 && <small>{record.tags.join(" · ")}</small>}</button>)}
        </aside>
        <div className="pc-folder-view" onContextMenu={(event) => openContext(event, { kind: "desktop", x: event.clientX, y: event.clientY, parentId: folderId })} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload) void moveRecordsTo(payload.ids, folderId); else void uploadFiles(event.dataTransfer.files, folderId); }}>
          <div className="pc-folder-commandbar">
            {item.trash ? <button className="danger" disabled={content.length === 0} onClick={() => void emptyRecycleBin()}><Trash2 size={15} />Empty Recycle Bin</button> : <>
              <button onClick={() => void createNote("text", folderId)}><Plus size={15} />New</button>
              <button onClick={() => void createFolder(folderId)}><Folder size={15} />Folder</button>
              <button onClick={() => chooseFiles(folderId)}><Upload size={15} />Upload</button>
            </>}
            {windowSelection.length > 0
              ? <span>{windowSelection.length} item{windowSelection.length === 1 ? "" : "s"} selected</span>
              : query && <span>{content.length} result{content.length === 1 ? "" : "s"}</span>}
          </div>
          <div className="pc-file-grid" onPointerDown={(event) => beginMarquee(event, event.currentTarget, windowSelection, applyWindowSelection)}>
            {!query && !item.trash && folderId === null && quickAccess.length > 0 && <section className="pc-quick-access"><strong>Quick access</strong><div>{quickAccess.map((record) => <button key={record.id} onClick={() => openRecord(record)}>{recordIcon(record, 25)}<span>{record.title}</span><small>{usage[record.id]?.count} opens</small></button>)}</div></section>}
            {content.map((record) => <button
              data-selection-id={record.id}
              draggable
              className={windowSelection.includes(record.id) ? "selected" : ""}
              key={record.id}
              onDragStart={(event) => { const ids = windowSelection.includes(record.id) ? windowSelection : [record.id]; if (!windowSelection.includes(record.id)) applyWindowSelection([record.id]); setRecordDragPayload(event.dataTransfer, recordIds(ids), record.id); }}
              onDragOver={(event) => { if (record.kind === "folder") event.preventDefault(); }}
              onDrop={(event) => { if (record.kind !== "folder") return; event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload) void moveRecordsTo(payload.ids, record.id); }}
              onClick={(event) => { event.stopPropagation(); selectOne(record.id, event, windowSelection, applyWindowSelection); }}
              onContextMenu={(event) => { const selectionIds = windowSelection.includes(record.id) ? windowSelection : [record.id]; if (!windowSelection.includes(record.id)) applyWindowSelection(selectionIds); openContext(event, { kind: "record", x: event.clientX, y: event.clientY, recordId: record.id, parentId: folderId, selectionIds }); }}
              onDoubleClick={() => item.trash ? void vault.restore(record) : openRecord(record)}
            ><span>{recordIcon(record, 38)}</span><strong>{record.title}</strong><small>{record.kind}{record.tags.length ? ` · ${record.tags.join(" · ")}` : ""}</small></button>)}
            {content.length === 0 && (query || item.trash || folderId !== null || quickAccess.length === 0) && <div className="pc-empty-folder">{query ? <><Search size={48} /><span>No matching files</span></> : <><FolderOpen size={48} /><span>This folder is empty</span></>}</div>}
          </div>
        </div>
      </div>
    </div>;
  };

  const wallpaper = vault.preferences.wallpaper;
  const wallpaperStyle: React.CSSProperties = { "--accent": vault.preferences.accent, "--explorer-sidebar-width": `${vault.preferences.sidebarWidth}px` } as React.CSSProperties;
  if (wallpaper?.kind === "solid") wallpaperStyle.background = wallpaper.value;
  if (wallpaper?.kind === "gradient") wallpaperStyle.background = wallpaper.value;
  if (wallpaper?.kind === "image" && wallpaper.value) Object.assign(wallpaperStyle, { backgroundImage: `url(${wallpaper.value})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" });
  const startResults = searchRecords(startSearch).slice(0, 12);

  const contextMenuContent = () => {
    if (!contextMenu) return null;
    const item = contextMenu.kind === "record" ? vault.records.find((record) => record.id === contextMenu.recordId) : undefined;
    const menuButton = (label: string, icon: React.ReactNode, action: () => void | Promise<void>, disabled = false) => <button disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={() => { void action(); setContextMenu(null); }}>{icon}<span>{label}</span></button>;
    return <section className="pc-context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 225), top: Math.min(contextMenu.y, window.innerHeight - 310) }} onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()}>
      {contextMenu.kind === "text" && <>
        {menuButton("Cut", <Scissors size={15} />, () => runTextCommand("cut"))}
        {menuButton("Copy", <Copy size={15} />, () => runTextCommand("copy"))}
        {menuButton("Paste", <ClipboardPaste size={15} />, () => runTextCommand("paste"))}
        {contextMenu.editor && <><hr />{menuButton("Turn selection into a password", <KeyRound size={15} />, contextMenu.convertSelection ?? (() => undefined), !contextMenu.convertSelection)}</>}
        <hr />
        {menuButton("Select all", <Check size={15} />, () => runTextCommand("selectAll"))}
      </>}
      {contextMenu.kind === "desktop" && <>
        {menuButton("New text note", <NotebookPen size={15} />, () => createNote("text", contextMenu.parentId))}
        {menuButton("New folder", <Folder size={15} />, () => createFolder(contextMenu.parentId))}
        {menuButton("Paste", <ClipboardPaste size={15} />, () => pasteInto(contextMenu.parentId), !fileClipboard)}
        <hr />
        {menuButton("Upload files", <Upload size={15} />, () => chooseFiles(contextMenu.parentId))}
        {menuButton("Refresh", <RefreshCw size={15} />, () => vault.sync())}
        <hr />
        {menuButton("Personalize", <Image size={15} />, () => openWindow("settings"))}
      </>}
      {contextMenu.kind === "record" && item && <>
        {menuButton(item.deletedAt ? "Restore" : "Open", item.deletedAt ? <RotateCcw size={15} /> : <FileText size={15} />, () => item.deletedAt ? vault.restore(item) : openRecord(item))}
        {menuButton("Rename", <Pencil size={15} />, () => renameRecord(item), Boolean(item.deletedAt))}
        <hr />
        {menuButton("Cut", <Scissors size={15} />, () => setFileClipboard({ recordId: item.id, cut: true }), Boolean(item.deletedAt))}
        {menuButton("Copy", <Copy size={15} />, () => setFileClipboard({ recordId: item.id, cut: false }), Boolean(item.deletedAt))}
        {menuButton(item.favorite ? "Remove from favorites" : "Add to favorites", <Star size={15} />, async () => { await vault.saveRecord({ ...item, favorite: !item.favorite } as VaultRecord); }, Boolean(item.deletedAt))}
        <hr />
        <div className="pc-context-label">Preset tags</div>
        {configuredTags.map((tag) => menuButton(`${item.tags.includes(tag.name) ? "✓ " : ""}${tag.name}`, <span className="pc-menu-tag" style={{ background: tag.color }} />, async () => { await vault.saveRecord({ ...item, tags: item.tags.includes(tag.name) ? item.tags.filter((name) => name !== tag.name) : [...item.tags, tag.name] } as VaultRecord); }, Boolean(item.deletedAt)))}
        <hr />
        {menuButton(contextMenu.selectionIds && contextMenu.selectionIds.length > 1 ? `Move ${contextMenu.selectionIds.length} items to Recycle Bin` : "Move to Recycle Bin", <Trash2 size={15} />, () => trashRecords(contextMenu.selectionIds?.length ? contextMenu.selectionIds : [item.id]), Boolean(item.deletedAt))}
      </>}
      {contextMenu.kind === "window" && (() => {
        const target = windowsRef.current.find((windowItem) => windowItem.id === contextMenu.windowId);
        if (!target) return null;
        return <>
          {menuButton(target.maximized ? "Restore" : "Maximize", <Maximize2 size={15} />, () => changeWindow(target.id, { maximized: !target.maximized }))}
          {menuButton("Minimize", <Minus size={15} />, () => minimizeWindow(target.id))}
          <hr />
          {menuButton("Close", <X size={15} />, () => closeWindow(target.id))}
        </>;
      })()}
      {contextMenu.kind === "recents" && (() => {
        const recent = vault.records.filter((record) => record.kind === contextMenu.recordKind && !record.deletedAt && usage[record.id]).sort((a, b) => (usage[b.id]?.lastOpened ?? "").localeCompare(usage[a.id]?.lastOpened ?? "")).slice(0, 5);
        return <><div className="pc-context-label">Recently opened</div>{recent.map((record) => menuButton(record.title, recordIcon(record, 15), () => openRecord(record)))}{recent.length === 0 && <span className="pc-context-empty">Nothing opened yet</span>}</>;
      })()}
    </section>;
  };

  return <main
    className={`pc-desktop ${vault.preferences.density} ${wallpaper?.kind && wallpaper.kind !== "default" ? "custom-wallpaper" : ""}`}
    data-theme={vault.preferences.theme}
    style={wallpaperStyle}
    onPointerDown={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".pc-window, .pc-taskbar, .pc-start-menu, .pc-context-menu, .pc-clipboard-toast")) return;
      if (desktopIconsRef.current) beginMarquee(event, desktopIconsRef.current, selectedIcons, setSelectedIcons);
    }}
    onClick={() => {
      if (suppressNextDesktopClick.current) { suppressNextDesktopClick.current = false; return; }
      setSelectedIcons([]); setSelectedRecords({}); setStartOpen(false); setContextMenu(null);
    }}
    onContextMenu={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true'], .cm-content")) return openContext(event, { kind: "text", x: event.clientX, y: event.clientY });
      const windowElement = target.closest<HTMLElement>("[data-window-id]");
      if (windowElement) return openContext(event, { kind: "window", x: event.clientX, y: event.clientY, windowId: windowElement.dataset.windowId! });
      openContext(event, { kind: "desktop", x: event.clientX, y: event.clientY, parentId: null });
    }}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => {
      event.preventDefault();
      const payload = getRecordDragPayload(event.dataTransfer);
      if (payload) {
        const ids = recordIds(payload.ids);
        if (ids.length) { void moveRecordsTo(ids, null); placeIcons(ids, payload.anchorId, slotAtPoint(event.clientX, event.clientY)); }
      } else void uploadFiles(event.dataTransfer.files);
    }}
  >
    <div className="pc-wallpaper-glow" />
    <section ref={desktopIconsRef} className="pc-desktop-icons">
      <DesktopIcon id="this-vault" label="This Vault" icon={<Monitor size={42} strokeWidth={1.35} />} slot={iconSlots["this-vault"] ?? 0} selected={selectedIcons.includes("this-vault")} onSelect={(event) => selectOne("this-vault", event, selectedIcons, setSelectedIcons)} onDragRecords={startDesktopDrag} onDropRecords={(payload) => void moveRecordsTo(payload.ids, null)} onContextMenu={(event) => { if (!selectedIcons.includes("this-vault")) setSelectedIcons(["this-vault"]); openContext(event, { kind: "desktop", x: event.clientX, y: event.clientY, parentId: null }); }} onOpen={() => openWindow("explorer", { folderId: null })} />
      <DesktopIcon id="password-manager" label="Password Manager" icon={<KeyRound size={41} strokeWidth={1.35} />} slot={iconSlots["password-manager"] ?? 2} selected={selectedIcons.includes("password-manager")} onSelect={(event) => selectOne("password-manager", event, selectedIcons, setSelectedIcons)} onDragRecords={startDesktopDrag} onDropRecords={() => undefined} onContextMenu={(event) => { if (!selectedIcons.includes("password-manager")) setSelectedIcons(["password-manager"]); openContext(event, { kind: "recents", x: event.clientX, y: event.clientY, recordKind: "secret" }); }} onOpen={() => openWindow("passwords")} />
      {desktopRecords.map((record) => <DesktopIcon key={record.id} id={record.id} label={record.title} icon={recordIcon(record, 42, true)} slot={iconSlots[record.id] ?? 3} selected={selectedIcons.includes(record.id)} onSelect={(event) => selectOne(record.id, event, selectedIcons, setSelectedIcons)} onDragRecords={startDesktopDrag} onDropRecords={(payload) => record.kind === "folder" ? void moveRecordsTo(payload.ids, record.id) : placeIcons(payload.ids, payload.anchorId, iconSlots[record.id] ?? 3)} onContextMenu={(event) => { const selectionIds = recordIds(selectedIcons.includes(record.id) ? selectedIcons : [record.id]); if (!selectedIcons.includes(record.id)) setSelectedIcons([record.id]); openContext(event, { kind: "record", x: event.clientX, y: event.clientY, recordId: record.id, parentId: null, selectionIds }); }} onOpen={() => openRecord(record)} />)}
      <DesktopIcon id="trash" label="Recycle Bin" icon={<Trash2 size={41} strokeWidth={1.35} />} slot={iconSlots.trash ?? 1} selected={selectedIcons.includes("trash")} onSelect={(event) => selectOne("trash", event, selectedIcons, setSelectedIcons)} onDragRecords={startDesktopDrag} onDropRecords={(payload) => void trashRecords(payload.ids)} onContextMenu={(event) => { if (!selectedIcons.includes("trash")) setSelectedIcons(["trash"]); openContext(event, { kind: "desktop", x: event.clientX, y: event.clientY, parentId: null }); }} onOpen={() => openWindow("explorer", { trash: true })} />
    </section>

    {marquee && <div className="pc-selection-marquee" style={marquee} />}

    {windows.map((item) => {
      const record = item.recordId ? vault.records.find((entry) => entry.id === item.recordId) : undefined;
      return <WindowFrame key={item.id} window={item} title={titleFor(item)} active={activeWindow?.id === item.id} motion={motions[item.id]}
        onFocus={() => focusWindow(item.id)} onGeometry={(patch) => changeWindow(item.id, patch)}
        onMinimize={() => minimizeWindow(item.id)} onMaximize={() => changeWindow(item.id, { maximized: !item.maximized })}
        onClose={() => closeWindow(item.id)} onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("input, textarea, [contenteditable='true'], .cm-content")) openContext(event, { kind: "text", x: event.clientX, y: event.clientY });
          else openContext(event, { kind: "window", x: event.clientX, y: event.clientY, windowId: item.id });
        }}>
        {item.kind === "explorer" ? explorerContent(item)
          : item.kind === "passwords" ? <PasswordManagerApp records={passwordRecords} tagDefinitions={configuredTags} onOpen={openRecord} onCreate={(view) => void createSecret(view)} />
          : item.kind === "settings" ? <SettingsApp preferences={vault.preferences} onSave={saveSettings} onChangePassword={changePassword} />
          : record?.kind === "note" ? <NoteEditor record={record} preferences={vault.preferences} desktopState={editorStates[record.id]} secrets={passwordRecords} onDesktopStateChange={(state) => setEditorStates((current) => ({ ...current, [record.id]: state }))} onCreateInlineSecret={createInlineSecret} onTextContextMenu={(event, convertSelection) => openContext(event, { kind: "text", x: event.clientX, y: event.clientY, editor: true, convertSelection })} onSave={save} />
          : record?.kind === "secret" ? <SecretEditor record={record} preferences={vault.preferences} onSave={save} />
          : record?.kind === "file" ? <FileViewer record={record} tagDefinitions={configuredTags} load={vault.downloadFile} onSave={save} />
          : <div className="pc-missing-file"><File size={48} /><span>This item is no longer available.</span></div>}
      </WindowFrame>;
    })}

    {startOpen && <section className="pc-start-menu" onClick={(event) => event.stopPropagation()}>
      <label className="pc-start-search"><Search size={16} /><input autoFocus aria-label="Search apps and files" placeholder="Search apps and files" value={startSearch} onChange={(event) => setStartSearch(event.target.value)} /></label>
      <strong>{startSearch ? "Search results" : "Pinned"}</strong>
      {startSearch ? <div className="pc-start-results">{startResults.map((record) => <button key={record.id} onClick={() => { openRecord(record); setStartOpen(false); }}>{recordIcon(record, 23)}<span>{record.title}</span><small>{record.kind}</small></button>)}{startResults.length === 0 && <span>No matching files</span>}</div> : <div className="pc-start-grid">
        <button onClick={() => void createNote()}><NotebookPen size={27} strokeWidth={1.4} /><span>Notepad</span></button>
        <button onClick={() => openWindow("explorer", { folderId: null })}><FolderOpen size={27} strokeWidth={1.4} /><span>File Explorer</span></button>
        <button onClick={() => openWindow("passwords")}><KeyRound size={27} strokeWidth={1.4} /><span>Password Manager</span></button>
        <button onClick={() => chooseFiles()}><Upload size={27} strokeWidth={1.4} /><span>Upload</span></button>
        <button onClick={() => void createFolder()}><Folder size={27} strokeWidth={1.4} /><span>New folder</span></button>
        <button onClick={() => { openWindow("settings"); setStartOpen(false); }}><Settings size={27} strokeWidth={1.4} /><span>Settings</span></button>
      </div>}
      <div className="pc-start-footer"><div><ShieldCheck size={18} /><span>Encrypted vault</span></div><button onClick={onLock}><Lock size={18} />Lock</button></div>
    </section>}

    <footer className="pc-taskbar" onClick={(event) => event.stopPropagation()}>
      <button className={`pc-start-button ${startOpen ? "active" : ""}`} title="Start" onClick={() => { setStartOpen((value) => !value); setContextMenu(null); }}><AppWindow size={22} strokeWidth={1.45} /></button>
      <button className="pc-pinned-app" title="Notepad" onClick={() => void createNote()} onContextMenu={(event) => openContext(event, { kind: "recents", x: event.clientX, y: event.clientY, recordKind: "note" })}><NotebookPen size={21} strokeWidth={1.45} /></button>
      <button className="pc-pinned-app" title="Password Manager" onClick={() => openWindow("passwords")} onContextMenu={(event) => openContext(event, { kind: "recents", x: event.clientX, y: event.clientY, recordKind: "secret" })}><KeyRound size={21} strokeWidth={1.45} /></button>
      <button className="pc-pinned-app" title="File Explorer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload) void moveRecordsTo(payload.ids, null); }} onClick={() => openWindow("explorer", { folderId: null })} onContextMenu={(event) => openContext(event, { kind: "recents", x: event.clientX, y: event.clientY, recordKind: "folder" })}><FolderOpen size={21} strokeWidth={1.45} /></button>
      <div className="pc-running-apps">
        {windows.map((item) => <button key={item.id} className={`${activeWindow?.id === item.id && !item.minimized ? "active" : ""}`} onDragOver={(event) => { if (item.kind === "explorer") event.preventDefault(); }} onDrop={(event) => { if (item.kind !== "explorer") return; event.preventDefault(); event.stopPropagation(); const payload = getRecordDragPayload(event.dataTransfer); if (payload) void moveRecordsTo(payload.ids, item.folderId ?? null); }} onClick={() => activeWindow?.id === item.id && !item.minimized ? minimizeWindow(item.id) : focusWindow(item.id)} onContextMenu={(event) => openContext(event, { kind: "window", x: event.clientX, y: event.clientY, windowId: item.id })}>{windowIcon(item.kind, 17)}<span>{titleFor(item)}</span></button>)}
      </div>
      <div className="pc-system-tray">
        <button title={vault.syncMessage || "Synchronization status"}>{vault.syncState === "offline" ? <CloudOff size={16} /> : <Cloud size={16} />}</button>
        <div><span>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><small>{clock.toLocaleDateString([], { month: "numeric", day: "numeric", year: "numeric" })}</small></div>
      </div>
    </footer>
    <div className="pc-start-hotspot" title="Start" onMouseEnter={() => { setStartOpen(true); setContextMenu(null); }} />

    {contextMenuContent()}
    {fileClipboard && <div className="pc-clipboard-toast"><Clipboard size={14} /><span>{fileClipboard.cut ? "Moving" : "Copied"}: {vault.records.find((record) => record.id === fileClipboard.recordId)?.title}</span><button onClick={() => setFileClipboard(null)}><X size={13} /></button></div>}
    {uploadProgress !== null && <div className="pc-upload-progress"><span style={{ width: `${uploadProgress}%` }} /></div>}
    <input ref={fileInput} type="file" hidden multiple onChange={(event) => { void uploadFiles(event.target.files, uploadParent.current); uploadParent.current = null; event.target.value = ""; }} />
  </main>;
}
