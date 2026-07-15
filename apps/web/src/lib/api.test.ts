import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API request encoding", () => {
  it("does not label an empty upload-completion request as JSON", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.completeBlob("00000000-0000-4000-8000-000000000001");

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    expect(calls[0]?.[0]).toBe("/api/v1/blobs/00000000-0000-4000-8000-000000000001/complete");
    const init = calls[0]?.[1];
    expect(init).toBeDefined();
    if (!init) throw new Error("Missing request options");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("sends encrypted chunk envelopes directly without a second base64 wrapper", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const envelope = { iv: "test-iv", ciphertext: "encrypted-content" };

    await api.putChunk("00000000-0000-4000-8000-000000000001", 0, envelope);

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const init = calls[0]?.[1];
    expect(init).toBeDefined();
    if (!init) throw new Error("Missing request options");
    expect(JSON.parse(String(init.body))).toEqual(envelope);
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});
