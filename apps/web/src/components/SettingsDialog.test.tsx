// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreferencesRecord } from "../types";
import { SettingsApp } from "./SettingsDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preferences = (updatedAt: string): PreferencesRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "preferences",
  title: "Preferences",
  parentId: null,
  tags: [],
  favorite: false,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt,
  theme: "system",
  accent: "#0f6cbd",
  editorFont: "ui-monospace, SFMono-Regular, Consolas, monospace",
  editorSize: 14,
  lineWrap: true,
  tabSize: 2,
  density: "comfortable",
  sidebarWidth: 272,
  autoLockMinutes: 15,
  clipboardSeconds: 30,
  defaultSecretView: "manager"
});

function enterInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => { document.body.innerHTML = ""; });

describe("SettingsApp", () => {
  it("keeps unsaved edits when desktop persistence updates preferences", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = { onSave: vi.fn(), onChangePassword: vi.fn(async () => undefined) };

    await act(async () => root.render(<SettingsApp preferences={preferences("2026-07-13T01:00:00.000Z")} {...props} />));
    const colorMode = host.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      colorMode.value = "dark";
      colorMode.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => root.render(<SettingsApp preferences={preferences("2026-07-13T01:00:01.000Z")} {...props} />));
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("dark");

    await act(async () => root.unmount());
  });

  it("adds, renames, recolors, and removes encrypted tag definitions", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn(async (_value: PreferencesRecord) => undefined);

    await act(async () => root.render(<SettingsApp preferences={preferences("2026-07-13T01:00:00.000Z")} onSave={onSave} onChangePassword={vi.fn(async () => undefined)} />));
    const tagNames = host.querySelectorAll<HTMLInputElement>('input[aria-label="Tag name"]');
    await act(async () => {
      enterInput(tagNames[0]!, "Projects");
    });
    const projectColor = host.querySelector<HTMLInputElement>('input[aria-label="Projects color"]')!;
    await act(async () => {
      enterInput(projectColor, "#123456");
    });
    const removeArchive = host.querySelector<HTMLButtonElement>('button[title="Remove Archive"]')!;
    await act(async () => removeArchive.click());
    const newName = host.querySelector<HTMLInputElement>('input[aria-label="New tag name"]')!;
    await act(async () => {
      enterInput(newName, "Client");
    });
    const add = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Add tag"))!;
    await act(async () => add.click());
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Save settings")!;
    await act(async () => save.click());

    const saved = onSave.mock.calls[0]![0];
    expect(saved.tagDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "work", name: "Projects", color: "#123456" }),
      expect.objectContaining({ name: "Client" })
    ]));
    expect(saved.tagDefinitions?.some((tag) => tag.id === "archive")).toBe(false);

    await act(async () => root.unmount());
  });
});
