// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NoteRecord, PreferencesRecord, SecretRecord } from "../types";
import { NoteEditor } from "./NoteEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0) });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: (id: number) => window.clearTimeout(id) });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-download") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => { document.body.innerHTML = ""; });

function enterInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

const note: NoteRecord = {
  id: "10000000-0000-4000-8000-000000000001", kind: "note", title: "Long note", parentId: null,
  tags: [], favorite: false, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
  mode: "text", content: "A very long line that should be wrapped by CodeMirror rather than by an outer CSS override."
};

const preferences = (lineWrap: boolean): PreferencesRecord => ({
  id: "00000000-0000-4000-8000-000000000001", kind: "preferences", title: "Preferences", parentId: null,
  tags: [], favorite: false, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
  theme: "light", accent: "#0f6cbd", editorFont: "monospace", editorSize: 14, lineWrap, tabSize: 2,
  density: "comfortable", sidebarWidth: 272, autoLockMinutes: 15, clipboardSeconds: 30, defaultSecretView: "simple"
});

describe("NoteEditor", () => {
  it("uses CodeMirror's wrapping extension instead of widening the editor canvas", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = { record: note, secrets: [], onDesktopStateChange: vi.fn(), onCreateInlineSecret: vi.fn(async () => undefined), onTextContextMenu: vi.fn(), onSave: vi.fn() };

    await act(async () => root.render(<NoteEditor {...props} preferences={preferences(true)} />));
    expect(host.querySelector(".cm-lineWrapping")).not.toBeNull();

    await act(async () => root.render(<NoteEditor {...props} preferences={preferences(false)} />));
    expect(host.querySelector(".cm-lineWrapping")).toBeNull();

    await act(async () => root.unmount());
  });

  it("ignores a stale Markdown split view for plain-text notes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(<NoteEditor
      record={note}
      preferences={preferences(true)}
      desktopState={{ anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0, view: "split" }}
      secrets={[]}
      onDesktopStateChange={vi.fn()}
      onCreateInlineSecret={vi.fn(async () => undefined)}
      onTextContextMenu={vi.fn()}
      onSave={vi.fn()}
    />));

    const grid = host.querySelector(".editor-grid");
    expect(grid?.classList.contains("source")).toBe(true);
    expect(grid?.classList.contains("split")).toBe(false);
    expect(host.querySelector(".markdown-preview")).toBeNull();

    await act(async () => root.unmount());
  });

  it("moves a selected line into a Password Manager record and replaces the plaintext", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selectedLine = "documentation-password";
    const record = { ...note, content: `${selectedLine}\nNext line` };
    const onCreateInlineSecret = vi.fn(async (_request: { id: string; value: string; noteId: string; noteTitle: string; line: number }) => undefined);
    const onTextContextMenu = vi.fn();

    await act(async () => root.render(<NoteEditor
      record={record}
      preferences={preferences(true)}
      secrets={[]}
      onDesktopStateChange={vi.fn()}
      onCreateInlineSecret={onCreateInlineSecret}
      onTextContextMenu={onTextContextMenu}
      onSave={vi.fn()}
    />));

    const editorElement = host.querySelector(".cm-editor") as HTMLElement;
    const editor = EditorView.findFromDOM(editorElement)!;
    await act(async () => editor.dispatch({ selection: { anchor: 0, head: selectedLine.length } }));
    await act(async () => host.querySelector(".cm-content")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    const convert = onTextContextMenu.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;
    expect(convert).toBeTypeOf("function");
    await act(async () => { await convert?.(); });

    expect(onCreateInlineSecret).toHaveBeenCalledOnce();
    expect(onCreateInlineSecret.mock.calls[0]?.[0]).toMatchObject({ value: selectedLine, noteId: record.id, noteTitle: record.title, line: 1 });
    expect(host.textContent).not.toContain(selectedLine);

    await act(async () => root.unmount());
  });

  it("renders linked passwords masked with Show and Copy controls", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const id = "20000000-0000-4000-8000-000000000002";
    const secret: SecretRecord = {
      id, kind: "secret", title: "Deployment login", parentId: null, tags: [], favorite: false,
      createdAt: note.createdAt, updatedAt: note.updatedAt, view: "manager", secretType: "password", username: "",
      password: "should-not-render-until-revealed", urls: [], notes: "", totpSecret: "", expiresAt: "", fields: []
    };

    await act(async () => root.render(<NoteEditor
      record={{ ...note, content: `Login: {{nkriz-secret:${id}}}` }}
      preferences={preferences(true)}
      secrets={[secret]}
      onDesktopStateChange={vi.fn()}
      onCreateInlineSecret={vi.fn(async () => undefined)}
      onTextContextMenu={vi.fn()}
      onSave={vi.fn()}
    />));

    expect(host.textContent).toContain("Deployment login");
    expect(host.textContent).not.toContain(secret.password);
    const show = host.querySelector('button[title="Show password"]') as HTMLButtonElement;
    await act(async () => show.click());
    expect(host.textContent).toContain(secret.password);
    expect(host.querySelector('button[title="Copy password"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("downloads notes with the in-app name and .txt as defaults", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let downloadedName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadedName = this.download; });

    await act(async () => root.render(<NoteEditor
      record={{ ...note, title: "Project guide.md" }}
      preferences={preferences(true)}
      secrets={[]}
      onDesktopStateChange={vi.fn()}
      onCreateInlineSecret={vi.fn(async () => undefined)}
      onTextContextMenu={vi.fn()}
      onSave={vi.fn()}
    />));

    const open = host.querySelector<HTMLButtonElement>('button[title="Download text file"]')!;
    await act(async () => open.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Download file name"]')!.value).toBe("Project guide.md");
    const format = host.querySelector<HTMLInputElement>('input[aria-label="Download format"]')!;
    expect(format.value).toBe(".txt");
    await act(async () => enterInput(format, "custom-log"));
    expect((host.querySelector<HTMLInputElement>('.note-export-passwords input[type="checkbox"]')!).checked).toBe(false);
    const confirm = host.querySelector<HTMLButtonElement>(".note-export-dialog button.primary")!;
    await act(async () => confirm.click());
    expect(downloadedName).toBe("Project guide.custom-log");
    expect(URL.createObjectURL).toHaveBeenCalled();

    click.mockRestore();
    await act(async () => root.unmount());
  });

  it("exports linked password values only when Expose passwords is checked", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const id = "30000000-0000-4000-8000-000000000003";
    const password = "plaintext-only-after-opt-in";
    const secret: SecretRecord = {
      id, kind: "secret", title: "Exported login", parentId: null, tags: [], favorite: false,
      createdAt: note.createdAt, updatedAt: note.updatedAt, view: "manager", secretType: "password", username: "",
      password, urls: [], notes: "", totpSecret: "", expiresAt: "", fields: []
    };
    let exportedBlob: Blob | undefined;
    vi.mocked(URL.createObjectURL).mockImplementationOnce((blob) => { exportedBlob = blob as Blob; return "blob:password-export"; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await act(async () => root.render(<NoteEditor
      record={{ ...note, content: `Login: {{nkriz-secret:${id}}}` }}
      preferences={preferences(true)}
      secrets={[secret]}
      onDesktopStateChange={vi.fn()}
      onCreateInlineSecret={vi.fn(async () => undefined)}
      onTextContextMenu={vi.fn()}
      onSave={vi.fn()}
    />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Download text file"]')!.click());
    await act(async () => host.querySelector<HTMLInputElement>('.note-export-passwords input[type="checkbox"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".note-export-dialog button.primary")!.click());
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob!);
    });
    expect(content).toContain(password);

    click.mockRestore();
    await act(async () => root.unmount());
  });
});
