import { Plus, X } from "lucide-react";
import { tagColor, tagDefinitions } from "../lib/tags";
import type { TagDefinition } from "../types";

export function TagPicker({ value, definitions, onChange, compact = false }: { value: string[]; definitions?: TagDefinition[]; onChange: (value: string[]) => void; compact?: boolean }) {
  const configured = tagDefinitions(definitions);
  const available = configured.filter((tag) => !value.includes(tag.name));
  return <div className={`tag-picker ${compact ? "compact" : ""}`}>
    <div className="tag-chips">
      {value.map((name) => <button key={name} type="button" className="tag-chip" style={{ "--tag-color": tagColor(name, configured) } as React.CSSProperties} onClick={() => onChange(value.filter((tag) => tag !== name))}><span />{name}<X size={11} /></button>)}
    </div>
    {available.length > 0 && <label className="tag-add"><Plus size={13} /><select aria-label="Add preset tag" value="" onChange={(event) => { if (event.target.value) onChange([...value, event.target.value]); }}><option value="">Add tag</option>{available.map((tag) => <option key={tag.name} value={tag.name}>{tag.name}</option>)}</select></label>}
  </div>;
}
