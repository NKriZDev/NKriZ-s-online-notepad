import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Clock3, FileText, Folder, Heart, Plus, Search, Tag, Trash2, Upload } from "lucide-react";
import type { FolderRecord, VaultRecord } from "../types";

export type Collection = "all" | "recent" | "favorites" | "trash" | `folder:${string}` | `tag:${string}`;

type Props = {
  records: VaultRecord[];
  collection: Collection;
  onCollection: (value: Collection) => void;
  search: string;
  onSearch: (value: string) => void;
  onNewFolder: (parentId: string | null) => void;
  onUpdateFolder: (folder: FolderRecord) => void;
  onUpload: () => void;
};

function FolderNode({ folder, folders, selected, onSelect, onNewFolder, onUpdateFolder }: {
  folder: FolderRecord; folders: FolderRecord[]; selected: string; onSelect: (value: Collection) => void; onNewFolder: (parentId: string | null) => void; onUpdateFolder: (folder: FolderRecord) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = folders.filter((item) => item.parentId === folder.id && !item.deletedAt);
  return <div className="folder-node">
    <div
      className={`nav-row ${selected === `folder:${folder.id}` ? "selected" : ""}`}
      draggable
      onClick={() => onSelect(`folder:${folder.id}`)}
      onDoubleClick={() => setOpen((value) => !value)}
      onContextMenu={(event) => { event.preventDefault(); onNewFolder(folder.id); }}
    >
      <button className="tree-toggle" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        {children.length ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span />}
      </button>
      <Folder size={16} fill={folder.color ?? "#e6b94a"} color={folder.color ?? "#b68512"} />
      <span>{folder.title}</span>
      {selected === `folder:${folder.id}` && <input className="folder-color" type="color" value={folder.color ?? "#e6b94a"} title="Folder color" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateFolder({ ...folder, color: event.target.value })} />}
    </div>
    {open && children.length > 0 && <div className="folder-children">
      {children.map((child) => <FolderNode key={child.id} folder={child} folders={folders} selected={selected} onSelect={onSelect} onNewFolder={onNewFolder} onUpdateFolder={onUpdateFolder} />)}
    </div>}
  </div>;
}

export function Sidebar({ records, collection, onCollection, search, onSearch, onNewFolder, onUpdateFolder, onUpload }: Props) {
  const folders = records.filter((record): record is FolderRecord => record.kind === "folder");
  const tags = useMemo(() => Array.from(new Set(records.flatMap((record) => record.tags))).sort(), [records]);
  return <aside className="sidebar">
    <div className="search-box"><Search size={15} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search this vault" /></div>
    <nav>
      <button className={`nav-row ${collection === "all" ? "selected" : ""}`} onClick={() => onCollection("all")}><FileText size={16} />All items</button>
      <button className={`nav-row ${collection === "recent" ? "selected" : ""}`} onClick={() => onCollection("recent")}><Clock3 size={16} />Recent</button>
      <button className={`nav-row ${collection === "favorites" ? "selected" : ""}`} onClick={() => onCollection("favorites")}><Heart size={16} />Favorites</button>
      <button className={`nav-row ${collection === "trash" ? "selected" : ""}`} onClick={() => onCollection("trash")}><Trash2 size={16} />Trash</button>
    </nav>
    <div className="side-heading"><span>Folders</span><button title="New folder" onClick={() => onNewFolder(null)}><Plus size={15} /></button></div>
    <div className="folder-tree">
      {folders.filter((folder) => !folder.parentId && !folder.deletedAt).map((folder) =>
        <FolderNode key={folder.id} folder={folder} folders={folders} selected={collection} onSelect={onCollection} onNewFolder={onNewFolder} onUpdateFolder={onUpdateFolder} />)}
      {!folders.some((folder) => !folder.deletedAt) && <div className="empty-side">No folders yet</div>}
    </div>
    {tags.length > 0 && <><div className="side-heading"><span>Tags</span></div><div className="tag-nav">
      {tags.map((tag) => <button key={tag} className={`nav-row ${collection === `tag:${tag}` ? "selected" : ""}`} onClick={() => onCollection(`tag:${tag}`)}><Tag size={14} />{tag}</button>)}
    </div></>}
    <div className="sidebar-bottom">
      <button onClick={onUpload}><Upload size={15} />Upload file</button>
      <button onClick={() => onNewFolder(null)}><Plus size={15} />New folder</button>
    </div>
  </aside>;
}
