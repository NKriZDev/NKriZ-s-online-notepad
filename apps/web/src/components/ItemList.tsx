import { Code2, File, FileText, Folder, Heart, KeyRound, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { VaultRecord } from "../types";

function icon(record: VaultRecord) {
  if (record.kind === "folder") return <Folder size={17} color={record.color} />;
  if (record.kind === "secret") return <KeyRound size={17} />;
  if (record.kind === "file") return <File size={17} />;
  if (record.kind === "note" && record.mode === "code") return <Code2 size={17} />;
  return <FileText size={17} />;
}

export function ItemList({ records, selectedId, title, onOpen, onFavorite, onDelete, onRestore, onMove }: {
  records: VaultRecord[]; selectedId: string | null; title: string;
  onOpen: (record: VaultRecord) => void; onFavorite: (record: VaultRecord) => void;
  onDelete: (record: VaultRecord) => void; onRestore: (record: VaultRecord) => void;
  onMove: (record: VaultRecord, parentId: string | null) => void;
}) {
  return <section className="item-panel">
    <div className="item-heading"><div><strong>{title}</strong><span>{records.length} item{records.length === 1 ? "" : "s"}</span></div><MoreHorizontal size={18} /></div>
    <div className="item-list">
      {records.map((record) => <article
        key={record.id}
        className={`item-row ${selectedId === record.id ? "selected" : ""}`}
        onClick={() => onOpen(record)}
        draggable={!record.deletedAt}
        onDragStart={(event) => event.dataTransfer.setData("application/x-nkriz-record", record.id)}
        onDragOver={(event) => { if (record.kind === "folder") event.preventDefault(); }}
        onDrop={(event) => { if (record.kind === "folder") { event.preventDefault(); const id = event.dataTransfer.getData("application/x-nkriz-record"); const moved = records.find((item) => item.id === id); if (moved) onMove(moved, record.id); } }}
      >
        <div className="item-icon">{icon(record)}</div>
        <div className="item-copy"><strong>{record.title || "Untitled"}</strong><span>{record.kind} · {new Date(record.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span></div>
        <div className="item-actions">
          {record.deletedAt ? <button title="Restore" onClick={(event) => { event.stopPropagation(); onRestore(record); }}><RotateCcw size={15} /></button> : <>
            <button title="Favorite" className={record.favorite ? "active" : ""} onClick={(event) => { event.stopPropagation(); onFavorite(record); }}><Heart size={15} fill={record.favorite ? "currentColor" : "none"} /></button>
            <button title="Move to trash" onClick={(event) => { event.stopPropagation(); onDelete(record); }}><Trash2 size={15} /></button>
          </>}
        </div>
      </article>)}
      {records.length === 0 && <div className="empty-list"><FileText size={34} /><strong>Nothing here</strong><span>Create a note or drop a file to begin.</span></div>}
    </div>
  </section>;
}
