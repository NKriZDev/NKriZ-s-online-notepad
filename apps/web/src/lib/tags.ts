import type { TagDefinition } from "../types";

export const DEFAULT_TAGS: TagDefinition[] = [
  { id: "work", name: "Work", color: "#4f7cac" },
  { id: "personal", name: "Personal", color: "#8b6f9f" },
  { id: "important", name: "Important", color: "#b8564f" },
  { id: "login", name: "Login", color: "#a47b2f" },
  { id: "code", name: "Code", color: "#467f72" },
  { id: "media", name: "Media", color: "#6b76a8" },
  { id: "archive", name: "Archive", color: "#73777d" }
];

export function tagDefinitions(value?: TagDefinition[]): TagDefinition[] {
  return (value ?? DEFAULT_TAGS).map((tag) => ({ ...tag }));
}

export function tagColor(name: string, definitions?: TagDefinition[]): string {
  return tagDefinitions(definitions).find((tag) => tag.name === name)?.color ?? "#73777d";
}

export function reconcileTags(current: string[], previousDefinitions: TagDefinition[], nextDefinitions: TagDefinition[]): string[] {
  const previousByName = new Map(previousDefinitions.map((tag) => [tag.name, tag]));
  const nextById = new Map(nextDefinitions.map((tag) => [tag.id, tag]));
  return Array.from(new Set(current.flatMap((name) => {
    const previous = previousByName.get(name);
    if (!previous) return [name];
    const replacement = nextById.get(previous.id);
    return replacement ? [replacement.name] : [];
  })));
}
