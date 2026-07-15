import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type ViewUpdate } from "@codemirror/view";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clipboard, Columns2, Download, Eye, EyeOff, FileCode2, KeyRound, Pencil, X } from "lucide-react";
import type { EditorDesktopState, NoteRecord, PreferencesRecord, SecretRecord } from "../types";
import { TagPicker } from "./TagPicker";

type ViewMode = "source" | "preview" | "split";
type InlineSecretRequest = { id: string; value: string; noteId: string; noteTitle: string; line: number };
const inlineSecretSource = "\\{\\{nkriz-secret:([0-9a-f-]{36})\\}\\}";
const inlineSecretMarker = (id: string) => `{{nkriz-secret:${id}}}`;
const exportFormats = [".txt", ".md", ".json", ".js", ".ts", ".tsx", ".py", ".css", ".html", ".xml", ".yaml", ".yml", ".toml", ".sh", ".sql", ".env", ".log"] as const;

class InlineSecretWidget extends WidgetType {
  constructor(private secret: SecretRecord | undefined, private revealed: boolean, private onToggle: () => void, private onCopy: () => void) { super(); }
  override eq(other: InlineSecretWidget) {
    return this.secret?.id === other.secret?.id && this.secret?.title === other.secret?.title && this.secret?.password === other.secret?.password && this.revealed === other.revealed;
  }
  toDOM() {
    const root = document.createElement("span");
    root.className = `inline-secret-reference${this.secret ? "" : " missing"}`;
    root.contentEditable = "false";
    const label = document.createElement("strong");
    label.textContent = this.secret?.title ?? "Missing password";
    const value = document.createElement("code");
    value.textContent = this.secret && this.revealed ? this.secret.password : "••••••••••••";
    root.append(label, value);
    if (this.secret) {
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.title = this.revealed ? "Hide password" : "Show password";
      reveal.textContent = this.revealed ? "Hide" : "Show";
      reveal.addEventListener("mousedown", (event) => event.preventDefault());
      reveal.addEventListener("click", (event) => { event.stopPropagation(); this.onToggle(); });
      const copy = document.createElement("button");
      copy.type = "button";
      copy.title = "Copy password";
      copy.textContent = "Copy";
      copy.addEventListener("mousedown", (event) => event.preventDefault());
      copy.addEventListener("click", (event) => { event.stopPropagation(); this.onCopy(); });
      root.append(reveal, copy);
    }
    return root;
  }
}

function InlineSecretPreview({ secret, revealed, onToggle, onCopy }: { secret?: SecretRecord; revealed: boolean; onToggle: () => void; onCopy: () => void }) {
  return <span className={`inline-secret-reference${secret ? "" : " missing"}`}>
    <KeyRound size={13} /><strong>{secret?.title ?? "Missing password"}</strong><code>{secret && revealed ? secret.password : "••••••••••••"}</code>
    {secret && <><button type="button" title={revealed ? "Hide password" : "Show password"} onClick={onToggle}>{revealed ? <EyeOff size={13} /> : <Eye size={13} />}<span>{revealed ? "Hide" : "Show"}</span></button><button type="button" title="Copy password" onClick={onCopy}><Clipboard size={13} /><span>Copy</span></button></>}
  </span>;
}

export function NoteEditor({ record, preferences, desktopState, secrets, onDesktopStateChange, onCreateInlineSecret, onTextContextMenu, onSave }: {
  record: NoteRecord;
  preferences: PreferencesRecord;
  desktopState?: EditorDesktopState;
  secrets: SecretRecord[];
  onDesktopStateChange: (state: EditorDesktopState) => void;
  onCreateInlineSecret: (request: InlineSecretRequest) => Promise<void>;
  onTextContextMenu: (event: React.MouseEvent, convertSelection?: () => Promise<void>) => void;
  onSave: (record: NoteRecord) => void;
}) {
  const [draft, setDraft] = useState(record);
  const [view, setView] = useState<ViewMode>(record.mode === "markdown" ? desktopState?.view ?? "split" : "source");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(() => new Set());
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState(record.title);
  const [exportFormat, setExportFormat] = useState(".txt");
  const [exportPasswords, setExportPasswords] = useState(false);
  const first = useRef(true);
  const draftRef = useRef(draft);
  const editorRef = useRef<EditorView | null>(null);
  const desktopRef = useRef<EditorDesktopState>(desktopState ?? { anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0, view });
  useEffect(() => {
    setDraft(record);
    draftRef.current = record;
    const restored = desktopState ?? { anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0, view: record.mode === "markdown" ? "split" : "source" };
    const restoredView: ViewMode = record.mode === "markdown" ? restored.view ?? "split" : "source";
    desktopRef.current = { ...restored, view: restoredView };
    setView(restoredView);
    setRevealedSecrets(new Set());
    setEditorGeneration(0);
    setExportOpen(false);
    setExportName(record.title);
    setExportFormat(".txt");
    setExportPasswords(false);
    first.current = true;
  }, [record.id]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timeout = window.setTimeout(() => onSave(draft), 250);
    return () => window.clearTimeout(timeout);
  }, [draft, onSave]);
  useEffect(() => () => onSave(draftRef.current), [record.id, onSave]);
  useEffect(() => {
    if (!preferences.lineWrap) return;
    const frame = requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.scrollDOM.scrollLeft = 0;
      desktopRef.current = { ...desktopRef.current, scrollLeft: 0 };
    });
    return () => cancelAnimationFrame(frame);
  }, [preferences.lineWrap]);
  const reportEditorState = (patch: Partial<EditorDesktopState>) => {
    desktopRef.current = { ...desktopRef.current, ...patch };
    onDesktopStateChange(desktopRef.current);
  };
  const changeView = (next: ViewMode) => { setView(next); reportEditorState({ view: next }); };
  const changeMode = (mode: NoteRecord["mode"]) => {
    setDraft({ ...draft, mode });
    if (mode !== "markdown" && view !== "source") changeView("source");
  };
  const openExport = () => {
    setExportName(draftRef.current.title);
    setExportFormat(".txt");
    setExportPasswords(false);
    setExportOpen(true);
  };
  const downloadText = () => {
    const entered = exportName.trim() || draftRef.current.title || "Untitled";
    const base = entered.replace(/\.[^./\\]+$/, "") || "Untitled";
    const typedExtension = exportFormat.trim().replace(/^\.+/, "").replace(/[^a-zA-Z0-9._-]/g, "");
    const extension = `.${typedExtension || "txt"}`;
    const filename = `${base}${extension}`;
    const mime = extension === ".md" ? "text/markdown" : extension === ".json" ? "application/json" : "text/plain";
    const exportedContent = draftRef.current.content.replace(new RegExp(inlineSecretSource, "g"), (_match, id: string) => {
      const secret = secretById.get(id);
      if (!secret) return "[Missing password]";
      return exportPasswords ? secret.password : `[Password: ${secret.title}]`;
    });
    const blob = new Blob([exportedContent], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };
  const copySecret = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    window.setTimeout(() => navigator.clipboard.writeText("").catch(() => undefined), preferences.clipboardSeconds * 1000);
  }, [preferences.clipboardSeconds]);
  const toggleSecret = useCallback((id: string) => setRevealedSecrets((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const secretById = useMemo(() => new Map(secrets.filter((secret) => !secret.deletedAt).map((secret) => [secret.id, secret])), [secrets]);
  const inlineSecretExtension = useMemo(() => EditorView.decorations.compute(["doc"], (state) => {
    const ranges = [];
    const pattern = new RegExp(inlineSecretSource, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(state.doc.toString()))) {
      const id = match[1]!;
      const secret = secretById.get(id);
      ranges.push(Decoration.replace({
        widget: new InlineSecretWidget(secret, revealedSecrets.has(id), () => toggleSecret(id), () => { if (secret) void copySecret(secret.password); })
      }).range(match.index, match.index + match[0].length));
    }
    return Decoration.set(ranges);
  }), [copySecret, revealedSecrets, secretById, toggleSecret]);
  const convertSelection = (from: number, to: number, value: string, line: number) => async () => {
    const current = draftRef.current;
    if (current.content.slice(from, to) !== value) return;
    const id = crypto.randomUUID();
    const marker = inlineSecretMarker(id);
    const converted = { ...current, content: `${current.content.slice(0, from)}${marker}${current.content.slice(to)}` };
    const cursor = from + marker.length;
    desktopRef.current = { ...desktopRef.current, anchor: cursor, head: cursor };
    draftRef.current = converted;
    setDraft(converted);
    setEditorGeneration((generation) => generation + 1);
    try {
      await onCreateInlineSecret({ id, value, noteId: current.id, noteTitle: current.title, line });
    } catch {
      const latest = draftRef.current;
      const markerAt = latest.content.indexOf(marker);
      if (markerAt >= 0) {
        const reverted = { ...latest, content: `${latest.content.slice(0, markerAt)}${value}${latest.content.slice(markerAt + marker.length)}` };
        draftRef.current = reverted;
        setDraft(reverted);
        setEditorGeneration((generation) => generation + 1);
      }
      window.alert("The password could not be created. The selected text was restored.");
    }
  };
  const openEditorContext = (event: React.MouseEvent) => {
    if (!(event.target as HTMLElement).closest(".cm-editor")) {
      onTextContextMenu(event);
      return;
    }
    const editor = editorRef.current;
    let convert: (() => Promise<void>) | undefined;
    if (editor) {
      const selection = editor.state.selection.main;
      let to = selection.to;
      let value = editor.state.doc.sliceString(selection.from, to);
      if (value.endsWith("\n") && !value.slice(0, -1).includes("\n")) { value = value.slice(0, -1); to--; }
      if (selection.from < to && value.length > 0 && !value.includes("\n") && !new RegExp(inlineSecretSource).test(value)) {
        convert = convertSelection(selection.from, to, value, editor.state.doc.lineAt(selection.from).number);
      }
    }
    onTextContextMenu(event, convert);
  };
  const editorUpdate = (update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return;
    const selection = update.state.selection.main;
    reportEditorState({ anchor: selection.anchor, head: selection.head });
  };
  const editorCreated = (editor: EditorView) => {
    editorRef.current = editor;
    const max = editor.state.doc.length;
    const anchor = Math.min(desktopRef.current.anchor, max);
    const head = Math.min(desktopRef.current.head, max);
    editor.dispatch({ selection: { anchor, head } });
    requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = desktopRef.current.scrollTop;
      editor.scrollDOM.scrollLeft = preferences.lineWrap ? 0 : desktopRef.current.scrollLeft;
    });
    editor.scrollDOM.addEventListener("scroll", () => reportEditorState({ scrollTop: editor.scrollDOM.scrollTop, scrollLeft: editor.scrollDOM.scrollLeft }), { passive: true });
  };
  const extensions = useMemo(() => {
    const base = [EditorState.tabSize.of(preferences.tabSize), inlineSecretExtension];
    if (preferences.lineWrap) base.push(EditorView.lineWrapping);
    if (draft.mode === "markdown") return [...base, markdown()];
    if (draft.language === "json") return [...base, json()];
    if (draft.language === "python") return [...base, python()];
    if (["javascript", "typescript"].includes(draft.language ?? "")) return [...base, javascript({ typescript: draft.language === "typescript" })];
    return base;
  }, [draft.language, draft.mode, inlineSecretExtension, preferences.lineWrap, preferences.tabSize]);
  const effectiveView: ViewMode = draft.mode === "markdown" ? view : "source";
  const previewContent = useMemo(() => draft.content.replace(new RegExp(inlineSecretSource, "g"), (_match, id: string) => `[Password](#nkriz-secret-${id})`), [draft.content]);
  return <div className="editor-surface">
    <div className="document-toolbar">
      <input className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Note title" />
      <div className="mode-group">
        <select value={draft.mode} onChange={(event) => changeMode(event.target.value as NoteRecord["mode"])}>
          <option value="text">Plain text</option><option value="markdown">Markdown</option><option value="code">Code</option>
        </select>
        {draft.mode === "code" && <select value={draft.language ?? "text"} onChange={(event) => setDraft({ ...draft, language: event.target.value })}>
          <option value="text">Text</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="json">JSON</option><option value="python">Python</option>
        </select>}
      </div>
      <TagPicker compact value={draft.tags} definitions={preferences.tagDefinitions} onChange={(tags) => setDraft({ ...draft, tags })} />
      {draft.mode === "markdown" && <div className="segmented">
        <button className={view === "source" ? "active" : ""} onClick={() => changeView("source")} title="Source"><Pencil size={15} /></button>
        <button className={view === "split" ? "active" : ""} onClick={() => changeView("split")} title="Split"><Columns2 size={15} /></button>
        <button className={view === "preview" ? "active" : ""} onClick={() => changeView("preview")} title="Preview"><Eye size={15} /></button>
      </div>}
      <button type="button" className="toolbar-button" title="Download text file" onClick={openExport}><Download size={15} />Download</button>
    </div>
    <div className={`editor-grid ${effectiveView} ${preferences.lineWrap ? "" : "no-wrap"}`} onContextMenu={openEditorContext}>
      {effectiveView !== "preview" && <CodeMirror
        key={`${record.id}:${editorGeneration}`}
        value={draft.content}
        height="100%"
        extensions={extensions}
        onCreateEditor={editorCreated}
        onUpdate={editorUpdate}
        onChange={(content) => setDraft({ ...draft, content })}
        basicSetup={{ lineNumbers: draft.mode === "code", highlightActiveLine: true, foldGutter: draft.mode === "code", autocompletion: true }}
        theme={preferences.theme === "dark" || (preferences.theme === "system" && systemDark) ? "dark" : "light"}
        width="100%"
        style={{ fontFamily: preferences.editorFont, fontSize: preferences.editorSize, height: "100%" }}
      />}
      {draft.mode === "markdown" && effectiveView !== "source" && <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
        const match = href?.match(/^#nkriz-secret-([0-9a-f-]{36})$/);
        if (!match) return <a href={href}>{children}</a>;
        const id = match[1]!;
        const secret = secretById.get(id);
        return <InlineSecretPreview secret={secret} revealed={revealedSecrets.has(id)} onToggle={() => toggleSecret(id)} onCopy={() => { if (secret) void copySecret(secret.password); }} />;
      } }}>{previewContent}</ReactMarkdown></div>}
      {draft.mode !== "markdown" && !draft.content && <div className="editor-watermark"><FileCode2 size={50} /><span>Start typing…</span></div>}
    </div>
    {exportOpen && <div className="note-export-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false); }}>
      <section className="note-export-dialog" role="dialog" aria-modal="true" aria-labelledby="note-export-title">
        <header><div><Download size={17} /><strong id="note-export-title">Download text file</strong></div><button type="button" title="Close" onClick={() => setExportOpen(false)}><X size={16} /></button></header>
        <div>
          <label>File name<input autoFocus aria-label="Download file name" value={exportName} onChange={(event) => setExportName(event.target.value)} /></label>
          <label>Format<input aria-label="Download format" list="note-export-formats" value={exportFormat} placeholder=".txt" onChange={(event) => setExportFormat(event.target.value)} /><datalist id="note-export-formats">{exportFormats.map((format) => <option key={format} value={format} />)}</datalist></label>
          <small>The selected format replaces any existing extension in the file name.</small>
          <label className="note-export-passwords"><input type="checkbox" checked={exportPasswords} onChange={(event) => setExportPasswords(event.target.checked)} /><span><strong>Expose passwords</strong><small>Write linked password values into the downloaded file as readable plaintext.</small></span></label>
        </div>
        <footer><button type="button" className="secondary" onClick={() => setExportOpen(false)}>Cancel</button><button type="button" className="primary" onClick={downloadText}><Download size={15} />Download</button></footer>
      </section>
    </div>}
  </div>;
}
