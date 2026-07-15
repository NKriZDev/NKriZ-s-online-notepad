import { useEffect, useRef, useState } from "react";
import { Clipboard, Columns2, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generatePassword, parseJwt, passwordStrength, totp } from "../lib/totp";
import type { PreferencesRecord, SecretRecord } from "../types";
import { TagPicker } from "./TagPicker";

export function SecretEditor({ record, preferences, onSave }: { record: SecretRecord; preferences: PreferencesRecord; onSave: (record: SecretRecord) => void }) {
  const [draft, setDraft] = useState(record);
  const [revealed, setRevealed] = useState(false);
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(30);
  const [multiMode, setMultiMode] = useState<"edit" | "split" | "preview">("split");
  const [revealedEntries, setRevealedEntries] = useState<Record<string, boolean>>({});
  const first = useRef(true);
  useEffect(() => { setDraft(record); first.current = true; }, [record.id]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timeout = window.setTimeout(() => onSave(draft), 300);
    return () => window.clearTimeout(timeout);
  }, [draft, onSave]);
  useEffect(() => {
    if (!draft.totpSecret) { setCode(""); return; }
    const update = () => void totp(draft.totpSecret).then((value) => { setCode(value.code); setRemaining(value.remaining); }).catch(() => setCode("Invalid secret"));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [draft.totpSecret]);
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    window.setTimeout(() => navigator.clipboard.writeText("").catch(() => undefined), preferences.clipboardSeconds * 1000);
  };
  const strength = passwordStrength(draft.password);
  const jwt = draft.secretType === "jwt" && draft.password ? parseJwt(draft.password) : null;
  return <div className="secret-editor editor-surface">
    <div className="document-toolbar">
      <KeyRound size={19} />
      <input className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <TagPicker compact value={draft.tags} definitions={preferences.tagDefinitions} onChange={(tags) => setDraft({ ...draft, tags })} />
      <div className="segmented text-segments">
        <button className={draft.view === "simple" ? "active" : ""} onClick={() => setDraft({ ...draft, view: "simple" })}>Simple</button>
        <button className={draft.view === "manager" ? "active" : ""} onClick={() => setDraft({ ...draft, view: "manager" })}>Manager</button>
        <button className={draft.view === "multi" ? "active" : ""} onClick={() => setDraft({ ...draft, view: "multi", multiEntries: draft.multiEntries ?? [], multiIntro: draft.multiIntro ?? "" })}>Multi-password</button>
      </div>
    </div>
    <div className="secret-form">
      {draft.view !== "multi" && <div className="form-grid">
        <label>Type<select value={draft.secretType} onChange={(event) => setDraft({ ...draft, secretType: event.target.value as SecretRecord["secretType"] })}>
          <option value="password">Password</option><option value="api-key">API key</option><option value="jwt">JWT</option><option value="token">Token</option><option value="other">Other</option>
        </select></label>
        <label>Expires<input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></label>
      </div>}
      {draft.view === "multi" ? <div className="multi-password-editor">
        <div className="multi-password-toolbar"><span>Write an explanation, then keep labeled passwords beside it.</span><div className="segmented"><button className={multiMode === "edit" ? "active" : ""} onClick={() => setMultiMode("edit")} title="Edit"><Pencil size={15} /></button><button className={multiMode === "split" ? "active" : ""} onClick={() => setMultiMode("split")} title="Split"><Columns2 size={15} /></button><button className={multiMode === "preview" ? "active" : ""} onClick={() => setMultiMode("preview")} title="Preview"><Eye size={15} /></button></div></div>
        <div className={`multi-password-grid ${multiMode}`}>
          {multiMode !== "preview" && <div className="multi-password-source"><label>Explanation (Markdown)<textarea rows={9} value={draft.multiIntro ?? ""} onChange={(event) => setDraft({ ...draft, multiIntro: event.target.value })} placeholder="Explain what these passwords are used for…" /></label><div className="field-heading"><strong>Passwords</strong><button onClick={() => setDraft({ ...draft, multiEntries: [...(draft.multiEntries ?? []), { id: crypto.randomUUID(), label: "", password: "" }] })}><Plus size={15} />Add password</button></div>{(draft.multiEntries ?? []).map((entry) => <div className="multi-password-row" key={entry.id}><input value={entry.label} placeholder="Explanation" onChange={(event) => setDraft({ ...draft, multiEntries: (draft.multiEntries ?? []).map((item) => item.id === entry.id ? { ...item, label: event.target.value } : item) })} /><input type="password" value={entry.password} placeholder="Password" autoComplete="new-password" onChange={(event) => setDraft({ ...draft, multiEntries: (draft.multiEntries ?? []).map((item) => item.id === entry.id ? { ...item, password: event.target.value } : item) })} /><button title="Generate" onClick={() => setDraft({ ...draft, multiEntries: (draft.multiEntries ?? []).map((item) => item.id === entry.id ? { ...item, password: generatePassword() } : item) })}><RefreshCw size={14} /></button><button title="Delete" onClick={() => setDraft({ ...draft, multiEntries: (draft.multiEntries ?? []).filter((item) => item.id !== entry.id) })}><Trash2 size={14} /></button></div>)}</div>}
          {multiMode !== "edit" && <div className="multi-password-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.multiIntro ?? ""}</ReactMarkdown><div className="multi-password-complete">{(draft.multiEntries ?? []).map((entry) => <div key={entry.id}><strong>{entry.label || "Password"}:</strong><code>{revealedEntries[entry.id] ? entry.password : "••••••••••••"}</code><button title={revealedEntries[entry.id] ? "Hide" : "Reveal"} onClick={() => setRevealedEntries((current) => ({ ...current, [entry.id]: !current[entry.id] }))}>{revealedEntries[entry.id] ? <EyeOff size={15} /> : <Eye size={15} />}</button><button title="Copy" onClick={() => copy(entry.password)}><Clipboard size={15} /></button></div>)}</div></div>}
        </div>
        <label>Private notes<textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      </div> : <>
      {draft.view === "manager" && <label>Username<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoComplete="off" /></label>}
      <label>Secret value<div className="secret-input"><input type={revealed ? "text" : "password"} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" /><button onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={17} /> : <Eye size={17} />}</button><button onClick={() => copy(draft.password)}><Clipboard size={17} /></button>{draft.view === "manager" && <button onClick={() => setDraft({ ...draft, password: generatePassword() })}><RefreshCw size={17} /></button>}</div></label>
      {draft.view === "manager" && draft.secretType === "password" && <div className="strength"><span style={{ width: `${(strength.score + 1) * 20}%` }} /><small>{strength.label}</small></div>}
      {draft.view === "manager" && <>
        <label>Website URLs<textarea rows={2} value={draft.urls.join("\n")} onChange={(event) => setDraft({ ...draft, urls: event.target.value.split("\n").filter(Boolean) })} placeholder="https://example.com" /></label>
        <label>TOTP secret<div className="totp-row"><input value={draft.totpSecret} onChange={(event) => setDraft({ ...draft, totpSecret: event.target.value })} placeholder="Base32 secret" />{code && <button className="totp-code" onClick={() => copy(code)}>{code}<small>{remaining}s</small></button>}</div></label>
        <div className="custom-fields"><div className="field-heading"><strong>Custom fields</strong><button onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), label: "", value: "", concealed: false }] })}><Plus size={15} /> Add field</button></div>
          {draft.fields.map((field) => <div className="custom-field" key={field.id}><input value={field.label} placeholder="Label" onChange={(event) => setDraft({ ...draft, fields: draft.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) })} /><input type={field.concealed ? "password" : "text"} value={field.value} placeholder="Value" onChange={(event) => setDraft({ ...draft, fields: draft.fields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) })} /><button onClick={() => setDraft({ ...draft, fields: draft.fields.filter((item) => item.id !== field.id) })}><Trash2 size={15} /></button></div>)}
        </div>
      </>}
      <label>Private notes<textarea rows={5} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      {jwt && <div className="jwt-panel"><div><ShieldAlert size={17} /><strong>Decoded locally — signature not verified</strong></div>{jwt.error ? <p>{jwt.error}</p> : <pre>{JSON.stringify(jwt.payload, null, 2)}</pre>}</div>}
      </>}
    </div>
  </div>;
}
