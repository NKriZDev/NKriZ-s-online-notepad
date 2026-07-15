import { useEffect, useRef, useState } from "react";
import { Crop, Download, File, LoaderCircle, RotateCcw, RotateCw, ShieldCheck } from "lucide-react";
import type { FileRecord, MediaEdits, TagDefinition } from "../types";
import { TagPicker } from "./TagPicker";

export function FileViewer({ record, tagDefinitions, load, onSave }: { record: FileRecord; tagDefinitions?: TagDefinition[]; load: (record: FileRecord) => Promise<Blob>; onSave: (record: FileRecord) => void }) {
  const [draft, setDraft] = useState(record);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cropOpen, setCropOpen] = useState(false);
  const first = useRef(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { setDraft(record); setCropOpen(false); first.current = true; }, [record.id]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timer = window.setTimeout(() => onSave(draft), 300);
    return () => window.clearTimeout(timer);
  }, [draft, onSave]);
  useEffect(() => {
    let currentUrl = "";
    setLoading(true); setError("");
    void load(record).then((blob) => { currentUrl = URL.createObjectURL(blob); setUrl(currentUrl); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Preview failed")).finally(() => setLoading(false));
    return () => { if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [load, record.id, record.blobId]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = draft.mediaEdits?.playbackRate ?? 1; }, [draft.mediaEdits?.playbackRate, url]);
  const updateEdits = (patch: Partial<MediaEdits>) => setDraft({ ...draft, mediaEdits: { ...draft.mediaEdits, ...patch } });
  const resetEdits = () => { setDraft({ ...draft, mediaEdits: undefined }); setCropOpen(false); };
  const cropValue = (edge: "cropTop" | "cropRight" | "cropBottom" | "cropLeft") => draft.mediaEdits?.[edge] ?? 0;
  const cropLimit = (edge: "cropTop" | "cropRight" | "cropBottom" | "cropLeft") => {
    const opposite = edge === "cropTop" ? "cropBottom" : edge === "cropBottom" ? "cropTop" : edge === "cropLeft" ? "cropRight" : "cropLeft";
    return 90 - cropValue(opposite);
  };
  const download = () => { const anchor = document.createElement("a"); anchor.href = url; anchor.download = record.title; anchor.click(); };
  const preview = () => {
    if (!url) return null;
    if (record.mime.startsWith("image/")) return <img className="file-image editable-media" style={{
      transform: `rotate(${draft.mediaEdits?.rotation ?? 0}deg)`,
      filter: `brightness(${draft.mediaEdits?.brightness ?? 100}%) contrast(${draft.mediaEdits?.contrast ?? 100}%)`,
      clipPath: `inset(${cropValue("cropTop")}% ${cropValue("cropRight")}% ${cropValue("cropBottom")}% ${cropValue("cropLeft")}%)`
    }} src={url} alt={record.title} />;
    if (record.mime.startsWith("audio/")) return <audio controls src={url} />;
    if (record.mime.startsWith("video/")) return <video ref={videoRef} controls src={url} loop={draft.mediaEdits?.loop} onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(draft.mediaEdits?.trimStart ?? 0, event.currentTarget.duration || 0); }} onTimeUpdate={(event) => { const end = draft.mediaEdits?.trimEnd; if (end && event.currentTarget.currentTime >= end) { if (draft.mediaEdits?.loop) event.currentTarget.currentTime = draft.mediaEdits?.trimStart ?? 0; else event.currentTarget.pause(); } }} />;
    if (record.mime === "application/pdf") return <iframe className="file-frame" src={url} title={record.title} />;
    if (record.mime.startsWith("text/")) return <iframe className="file-frame text-frame" src={url} title={record.title} />;
    return <div className="unsupported"><File size={64} /><strong>No in-browser preview</strong><span>This encrypted file can still be downloaded.</span></div>;
  };
  const image = record.mime.startsWith("image/");
  const video = record.mime.startsWith("video/");
  return <div className="editor-surface file-viewer">
    <div className="document-toolbar"><File size={18} /><strong className="file-title">{record.title}</strong><span className="file-size">{formatBytes(record.size)}</span><TagPicker compact value={draft.tags} definitions={tagDefinitions} onChange={(tags) => setDraft({ ...draft, tags })} /><button className="toolbar-button" disabled={!url} onClick={download}><Download size={15} />Download</button></div>
    <div className="file-preview">{loading ? <div className="loading-file"><LoaderCircle className="spin" /><span>Decrypting and verifying file…</span></div> : error ? <div className="error-banner">{error}</div> : preview()}</div>
    <div className="media-edit-panel">
      {(image || video) && <div className="media-edit-controls">
        <strong>Non-destructive edits</strong>
        <button className="secondary" onClick={resetEdits}><RotateCcw size={14} />Reset to default</button>
        {image && <>
          <button className="secondary" onClick={() => updateEdits({ rotation: ((draft.mediaEdits?.rotation ?? 0) + 90) % 360 })}><RotateCw size={14} />Rotate</button>
          <button className={cropOpen ? "secondary active" : "secondary"} onClick={() => setCropOpen((current) => !current)}><Crop size={14} />Crop</button>
          <label>Brightness<input type="range" min="25" max="175" value={draft.mediaEdits?.brightness ?? 100} onChange={(event) => updateEdits({ brightness: Number(event.target.value) })} /></label>
          <label>Contrast<input type="range" min="25" max="175" value={draft.mediaEdits?.contrast ?? 100} onChange={(event) => updateEdits({ contrast: Number(event.target.value) })} /></label>
        </>}
        {video && <>
          <label>Speed<select value={draft.mediaEdits?.playbackRate ?? 1} onChange={(event) => updateEdits({ playbackRate: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
          <label>Trim start<input type="number" min="0" step="0.1" value={draft.mediaEdits?.trimStart ?? 0} onChange={(event) => updateEdits({ trimStart: Number(event.target.value) })} /></label>
          <label>Trim end<input type="number" min="0" step="0.1" value={draft.mediaEdits?.trimEnd ?? 0} onChange={(event) => updateEdits({ trimEnd: Number(event.target.value) || undefined })} /></label>
          <label className="media-loop"><input type="checkbox" checked={draft.mediaEdits?.loop ?? false} onChange={(event) => updateEdits({ loop: event.target.checked })} />Loop</label>
        </>}
      </div>}
      {image && cropOpen && <div className="media-crop-controls">
        <strong>Crop edges</strong><span>Non-destructive percentage inset</span>
        {(["cropTop", "cropRight", "cropBottom", "cropLeft"] as const).map((edge) => <label key={edge}>
          {edge.slice(4)}
          <input type="range" min="0" max={cropLimit(edge)} value={cropValue(edge)} onChange={(event) => updateEdits({ [edge]: Number(event.target.value) })} />
          <output>{cropValue(edge)}%</output>
        </label>)}
      </div>}
      <label className="media-secret-note">Secret searchable note<textarea rows={2} value={draft.secretNote ?? ""} onChange={(event) => setDraft({ ...draft, secretNote: event.target.value })} placeholder="Private context, description, people, or keywords…" /></label>
    </div>
    <div className="integrity-line"><ShieldCheck size={14} />Integrity verified locally with SHA-256</div>
  </div>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
