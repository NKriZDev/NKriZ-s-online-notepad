import { useState } from "react";
import { KeyRound, Layers3, Plus, Search, ShieldCheck } from "lucide-react";
import { tagColor } from "../lib/tags";
import type { SecretRecord, TagDefinition } from "../types";

export function PasswordManagerApp({ records, tagDefinitions, onOpen, onCreate }: {
  records: SecretRecord[];
  tagDefinitions?: TagDefinition[];
  onOpen: (record: SecretRecord) => void;
  onCreate: (view: "manager" | "multi") => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = records.filter((record) => !record.deletedAt && [record.title, record.username, record.urls.join(" "), record.notes, record.multiIntro ?? "", ...(record.multiEntries ?? []).map((entry) => entry.label), ...record.tags].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="password-manager-app">
    <header className="password-manager-header"><div><KeyRound size={22} /><div><strong>Password Manager</strong><span>{records.filter((record) => !record.deletedAt).length} encrypted items</span></div></div><div><button className="secondary" onClick={() => onCreate("multi")}><Layers3 size={15} />Multi-password</button><button className="primary" onClick={() => onCreate("manager")}><Plus size={15} />New password</button></div></header>
    <label className="password-manager-search"><Search size={15} /><input aria-label="Search passwords" placeholder="Search passwords, usernames, URLs, and notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="password-manager-list">
      {filtered.map((record) => <button key={record.id} onDoubleClick={() => onOpen(record)} onClick={() => onOpen(record)}><span className="password-list-icon">{record.view === "multi" ? <Layers3 size={22} /> : <KeyRound size={22} />}</span><span><strong>{record.title}</strong><small>{record.view === "multi" ? `${record.multiEntries?.length ?? 0} passwords` : record.username || record.secretType}</small><span className="password-list-tags">{record.tags.map((tag) => <i key={tag} style={{ background: tagColor(tag, tagDefinitions) }}>{tag}</i>)}</span></span><ShieldCheck size={16} /></button>)}
      {filtered.length === 0 && <div className="password-manager-empty"><KeyRound size={44} /><strong>{query ? "No matching passwords" : "No passwords yet"}</strong><span>Create a password or multi-password record. Everything is encrypted before sync.</span></div>}
    </div>
  </div>;
}
