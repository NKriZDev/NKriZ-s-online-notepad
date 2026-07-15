import { useRef, useState } from "react";
import { Download, Image as ImageIcon, Monitor, Palette, Plus, Shield, SlidersHorizontal, Tags, Trash2, Type, Upload } from "lucide-react";
import { api } from "../lib/api";
import { tagDefinitions } from "../lib/tags";
import type { PreferencesRecord } from "../types";

const WALLPAPER_MAX_EDGE = 2560;

async function prepareWallpaper(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = document.createElement("img");
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image could not be opened by the browser."));
    });
    const scale = Math.min(1, WALLPAPER_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Wallpaper processing is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Preferences are encrypted records, not blob storage. Keep the wallpaper
    // compact enough to sync reliably while retaining desktop resolution.
    for (const quality of [.84, .72, .6, .48]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 1_500_000 || quality === .48) return result;
    }
    throw new Error("Wallpaper processing failed.");
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function SettingsApp({ preferences, onSave, onChangePassword }: {
  preferences: PreferencesRecord; onSave: (value: PreferencesRecord) => void | Promise<void>; onChangePassword: (password: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({ ...preferences, tagDefinitions: tagDefinitions(preferences.tagDefinitions) }));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [wallpaperMessage, setWallpaperMessage] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#4f7cac");
  const wallpaperInput = useRef<HTMLInputElement>(null);

  const save = async () => {
    const definitions = tagDefinitions(draft.tagDefinitions).map((tag) => ({ ...tag, name: tag.name.trim() }));
    if (definitions.some((tag) => !tag.name)) { setTagMessage("Tag names cannot be empty."); return; }
    if (new Set(definitions.map((tag) => tag.name.toLocaleLowerCase())).size !== definitions.length) { setTagMessage("Tag names must be unique."); return; }
    const next = { ...draft, tagDefinitions: definitions };
    try {
      await onSave(next);
      setDraft(next);
      setTagMessage("");
      setMessage("Settings and tags saved and encrypted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved."); }
  };
  const addTag = () => {
    const name = newTagName.trim();
    const definitions = tagDefinitions(draft.tagDefinitions);
    if (!name) { setTagMessage("Enter a tag name."); return; }
    if (definitions.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setTagMessage("That tag already exists."); return; }
    setDraft((current) => ({ ...current, tagDefinitions: [...tagDefinitions(current.tagDefinitions), { id: crypto.randomUUID(), name, color: newTagColor }] }));
    setNewTagName("");
    setTagMessage("");
  };
  const backup = async () => {
    const content = await api.backup();
    const blob = new Blob([JSON.stringify(content)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nkriz-vault-${new Date().toISOString().slice(0, 10)}.nkrizvault`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const changePassword = async () => {
    if (password.length < 12 || password !== confirm) { setMessage("Passwords must match and contain at least 12 characters."); return; }
    try {
      await onChangePassword(password);
      setMessage("Password changed. Other sessions were signed out.");
      setPassword(""); setConfirm("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Password change failed"); }
  };
  const chooseWallpaper = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setWallpaperMessage("Choose an image file."); return; }
    setWallpaperMessage("Preparing image…");
    try {
      const value = await prepareWallpaper(file);
      setDraft((current) => ({ ...current, wallpaper: { kind: "image", value } }));
      setWallpaperMessage(`${file.name} · ready to save`);
    } catch (error) {
      setWallpaperMessage(error instanceof Error ? error.message : "Wallpaper could not be prepared.");
    } finally {
      if (wallpaperInput.current) wallpaperInput.current.value = "";
    }
  };
  const setWallpaperKind = (kind: NonNullable<PreferencesRecord["wallpaper"]>["kind"]) => {
    const value = kind === "solid" ? "#18202b"
      : kind === "gradient" ? "linear-gradient(135deg, #101926, #244764 55%, #397d9b)"
      : "";
    setDraft((current) => ({ ...current, wallpaper: { kind, value } }));
    setWallpaperMessage("");
  };

  return <section className="settings-app">
    <header><div><SlidersHorizontal size={20} /><strong>Settings</strong></div><span>Encrypted and synchronized across devices</span></header>
    <div className="settings-body">
      <section className="settings-section">
        <div className="settings-section-title"><Palette size={18} /><div><h3>Appearance</h3><p>Theme, accent, and desktop density apply to the whole vault.</p></div></div>
        <div className="settings-grid">
          <label>Color mode<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as PreferencesRecord["theme"] })}><option value="system">Use system setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Accent color<div className="accent-control"><input aria-label="Accent color" type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} /><code>{draft.accent.toUpperCase()}</code></div></label>
          <label>Interface spacing<select value={draft.density} onChange={(event) => setDraft({ ...draft, density: event.target.value as PreferencesRecord["density"] })}><option value="comfortable">Comfortable — roomier</option><option value="compact">Compact — fit more</option></select></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Monitor size={18} /><div><h3>Desktop and File Explorer</h3><p>Choose a synced wallpaper and tune the Explorer layout.</p></div></div>
        <div className="wallpaper-options" role="radiogroup" aria-label="Desktop wallpaper">
          {(["default", "solid", "gradient", "image"] as const).map((kind) => <button key={kind} type="button" className={(draft.wallpaper?.kind ?? "default") === kind ? "selected" : ""} onClick={() => setWallpaperKind(kind)}><span className={`wallpaper-swatch ${kind}`} style={kind === "image" && draft.wallpaper?.kind === "image" && draft.wallpaper.value ? { backgroundImage: `url(${draft.wallpaper.value})` } : undefined} />{kind === "default" ? "Vault default" : kind === "solid" ? "Solid color" : kind === "gradient" ? "Gradient" : "My picture"}</button>)}
        </div>
        <div className="settings-grid wallpaper-controls">
          {draft.wallpaper?.kind === "solid" && <label>Desktop color<input type="color" value={draft.wallpaper.value || "#18202b"} onChange={(event) => setDraft({ ...draft, wallpaper: { kind: "solid", value: event.target.value } })} /></label>}
          {draft.wallpaper?.kind === "gradient" && <label className="wallpaper-wide">CSS gradient<input value={draft.wallpaper.value} onChange={(event) => setDraft({ ...draft, wallpaper: { kind: "gradient", value: event.target.value } })} /></label>}
          {draft.wallpaper?.kind === "image" && <div className="wallpaper-wide wallpaper-picker">
            <div className="wallpaper-preview" style={draft.wallpaper.value ? { backgroundImage: `url(${draft.wallpaper.value})` } : undefined}>{!draft.wallpaper.value && <ImageIcon size={28} />}</div>
            <div><strong>Custom wallpaper</strong><small>{wallpaperMessage || "JPG, PNG, WebP, GIF, or another browser-supported image."}</small><button type="button" className="secondary" onClick={() => wallpaperInput.current?.click()}><Upload size={15} />Choose image</button></div>
            <input ref={wallpaperInput} type="file" accept="image/*" onChange={(event) => void chooseWallpaper(event.target.files?.[0])} />
          </div>}
          <label>Explorer sidebar width<div className="range-control"><input type="range" min="150" max="380" value={draft.sidebarWidth} onChange={(event) => setDraft({ ...draft, sidebarWidth: Number(event.target.value) })} /><output>{draft.sidebarWidth}px</output></div></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Tags size={18} /><div><h3>Tags</h3><p>Create the reusable colored tags shown across folders, notes, passwords, and files.</p></div></div>
        <div className="tag-settings-list">
          {tagDefinitions(draft.tagDefinitions).map((tag) => <div className="tag-settings-row" key={tag.id}>
            <input aria-label={`${tag.name} color`} type="color" value={tag.color} onChange={(event) => setDraft((current) => ({ ...current, tagDefinitions: tagDefinitions(current.tagDefinitions).map((item) => item.id === tag.id ? { ...item, color: event.target.value } : item) }))} />
            <input aria-label="Tag name" value={tag.name} maxLength={40} onChange={(event) => setDraft((current) => ({ ...current, tagDefinitions: tagDefinitions(current.tagDefinitions).map((item) => item.id === tag.id ? { ...item, name: event.target.value } : item) }))} />
            <span className="tag-settings-preview" style={{ "--tag-color": tag.color } as React.CSSProperties}><i />{tag.name || "Unnamed tag"}</span>
            <button type="button" title={`Remove ${tag.name || "tag"}`} onClick={() => setDraft((current) => ({ ...current, tagDefinitions: tagDefinitions(current.tagDefinitions).filter((item) => item.id !== tag.id) }))}><Trash2 size={15} /></button>
          </div>)}
          {tagDefinitions(draft.tagDefinitions).length === 0 && <div className="tag-settings-empty">No tags configured. Add one below.</div>}
        </div>
        <div className="tag-settings-add">
          <input aria-label="New tag color" type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} />
          <input aria-label="New tag name" value={newTagName} maxLength={40} placeholder="New tag name" onChange={(event) => setNewTagName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} />
          <button type="button" className="secondary" onClick={addTag}><Plus size={15} />Add tag</button>
        </div>
        {tagMessage && <div className="tag-settings-message">{tagMessage}</div>}
        <small className="tag-settings-help">Renaming or removing a tag updates all tagged items when you save Settings.</small>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Type size={18} /><div><h3>Notepad and code</h3><p>These options apply to every text, Markdown, and code editor.</p></div></div>
        <div className="settings-grid">
          <label>Editor font<select value={draft.editorFont} onChange={(event) => setDraft({ ...draft, editorFont: event.target.value })}><option value="ui-monospace, SFMono-Regular, Consolas, monospace">System monospace</option><option value="Consolas, ui-monospace, monospace">Consolas</option><option value="'SFMono-Regular', ui-monospace, monospace">SF Mono</option><option value="'Courier New', monospace">Courier New</option></select></label>
          <label>Text size<div className="number-with-unit"><input type="number" min="11" max="24" value={draft.editorSize} onChange={(event) => setDraft({ ...draft, editorSize: Math.max(11, Math.min(24, Number(event.target.value))) })} /><span>px</span></div></label>
          <label>Code indentation<select value={draft.tabSize} onChange={(event) => setDraft({ ...draft, tabSize: Number(event.target.value) })}><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={draft.lineWrap} onChange={(event) => setDraft({ ...draft, lineWrap: event.target.checked })} /><span><strong>Wrap long lines</strong><small>Keep long text visible without horizontal scrolling.</small></span></label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><Shield size={18} /><div><h3>Security and backup</h3><p>Automatic locking and clipboard cleanup happen locally.</p></div></div>
        <div className="settings-grid">
          <label>Auto-lock after<div className="number-with-unit"><input type="number" min="1" max="240" value={draft.autoLockMinutes} onChange={(event) => setDraft({ ...draft, autoLockMinutes: Math.max(1, Math.min(240, Number(event.target.value))) })} /><span>minutes</span></div></label>
          <label>Clear copied secrets after<div className="number-with-unit"><input type="number" min="5" max="300" value={draft.clipboardSeconds} onChange={(event) => setDraft({ ...draft, clipboardSeconds: Math.max(5, Math.min(300, Number(event.target.value))) })} /><span>seconds</span></div></label>
        </div>
        <div className="security-box"><Shield size={19} /><div><strong>Zero-knowledge encryption is active</strong><span>Content is encrypted locally before sync. Keep your recovery key somewhere safe.</span></div></div>
        <button className="secondary" onClick={backup}><Download size={16} />Download encrypted backup</button>
        <div className="password-change"><strong>Change password</strong><input type="password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} /><input type="password" placeholder="Confirm new password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /><button className="secondary" onClick={changePassword}>Change password</button></div>
      </section>
      {message && <div className="settings-message">{message}</div>}
    </div>
    <footer><button className="primary" onClick={save}>Save settings</button></footer>
  </section>;
}
