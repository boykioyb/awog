// Run: npx vitest run src/browser-profiles/__tests__/proxy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempHome } from "./helpers.js";

const state = vi.hoisted(() => ({
  host: [] as { method: string; params: Record<string, unknown> }[],
  events: [] as { type: string; payload: unknown }[],
  keychain: new Map<string, string>(),
  hostError: null as Error | null,
}));

vi.mock("../../transport/stdio.js", () => ({
  emit: (type: string, payload: unknown) =>
    state.events.push({ type, payload }),
  hostRequest: async (method: string, params: Record<string, unknown>) => {
    state.host.push({ method, params });
    if (state.hostError) throw state.hostError;
    return {};
  },
}));
vi.mock("../../credentials/keychain.js", () => ({
  setKeychainValue: async (service: string, account: string, value: string) => {
    state.keychain.set(`${service}/${account}`, value);
  },
  getKeychainValue: async (service: string, account: string) =>
    state.keychain.get(`${service}/${account}`) ?? null,
  deleteKeychainValue: async (service: string, account: string) =>
    state.keychain.delete(`${service}/${account}`),
}));
vi.mock("../../sessions/store.js", () => ({
  getSessionBrowserRef: async () => null,
  listSessionBrowserRefs: async () => [],
  setSessionBrowserProfile: async () => true,
}));
vi.mock("../../projects/store.js", () => ({
  loadProject: async () => null,
  listProjects: async () => [],
  saveProject: async () => undefined,
}));
vi.mock("../../tasks/store.js", () => ({ loadTask: async () => null }));

import { createProfile, listProfiles } from "../profiles.js";
import { setProfileProxy, syncAllProxies } from "../proxy.js";
import { removeProfile } from "../scope.js";
import { validateProxyConfig } from "../proxy-config.js";

const KEY = (id: string): string => `awog-browser-proxy/${id}`;
const HTTP = { type: "http", host: "127.0.0.1", port: 8080 };

let cleanup: () => Promise<void>;
beforeEach(async () => {
  cleanup = await useTempHome();
  state.host.length = 0;
  state.events.length = 0;
  state.keychain.clear();
  state.hostError = null;
});
afterEach(async () => {
  await cleanup();
});

describe("validateProxyConfig", () => {
  it("accepts hostnames, IPv4, [IPv6] and trims", () => {
    expect(
      validateProxyConfig({
        type: "socks5",
        host: " proxy.example.com ",
        port: 1080,
      }),
    ).toEqual({
      type: "socks5",
      host: "proxy.example.com",
      port: 1080,
    });
    expect(
      validateProxyConfig({ type: "http", host: "[::1]", port: 3128 }).host,
    ).toBe("[::1]");
    expect(
      validateProxyConfig({ ...HTTP, bypass: "*.corp.com; 10.0.0.0/8,<local>" })
        .bypass,
    ).toBe("*.corp.com; 10.0.0.0/8,<local>");
  });

  it.each([
    [{ ...HTTP, type: "ftp" }, /type/],
    [{ ...HTTP, host: "http://x.com" }, /host/],
    [{ ...HTTP, host: "x.com/path" }, /host/],
    [{ ...HTTP, host: "a b" }, /host/],
    [{ ...HTTP, host: "::1" }, /host/],
    [{ ...HTTP, host: "" }, /host/],
    [{ ...HTTP, host: "a".repeat(254) }, /host/],
    [{ ...HTTP, port: 0 }, /port/],
    [{ ...HTTP, port: 65536 }, /port/],
    [{ ...HTTP, port: 1.5 }, /port/],
    [{ ...HTTP, bypass: "x".repeat(501) }, /bypass/],
    [{ ...HTTP, bypass: "a.com;rm -rf $(x)" }, /bypass/],
  ])("rejects %j", (input, re) => {
    expect(() => validateProxyConfig(input)).toThrow(re);
  });
});

describe("setProfileProxy", () => {
  it("stores non-secret config, keychain holds creds, pushes to main", async () => {
    const p = await createProfile({ name: "VPN" });
    const updated = await setProfileProxy({
      id: p.id,
      proxy: { ...HTTP, bypass: "*.x.com" },
      auth: { username: "u", password: "pw" },
    });
    expect(updated.proxy).toEqual({
      ...HTTP,
      bypass: "*.x.com",
      hasAuth: true,
    });
    expect(JSON.parse(state.keychain.get(KEY(p.id)) ?? "null")).toEqual({
      username: "u",
      password: "pw",
    });
    expect(state.host).toEqual([
      {
        method: "browser.setProfileProxy",
        params: {
          profile: p.id,
          proxy: { ...HTTP, bypass: "*.x.com" },
          auth: { username: "u", password: "pw" },
        },
      },
    ]);
    // Không bí mật nào lọt vào file / danh sách trả cho UI.
    const listed = JSON.stringify(await listProfiles());
    expect(listed).not.toContain("pw");
    expect(listed).toContain('"hasAuth":true');
  });

  it("rejects socks5 + auth and writes nothing", async () => {
    const p = await createProfile({ name: "S" });
    await expect(
      setProfileProxy({
        id: p.id,
        proxy: { type: "socks5", host: "h.example", port: 1080 },
        auth: { username: "u", password: "p" },
      }),
    ).rejects.toThrow(/SOCKS5.*not supported/);
    expect(state.keychain.size).toBe(0);
    expect(state.host).toHaveLength(0);
    expect(
      (await listProfiles()).profiles.find((x) => x.id === p.id)?.proxy,
    ).toBeUndefined();
  });

  it("rejects switching to socks5 while stored creds are kept; allowed after auth:null", async () => {
    const p = await createProfile({ name: "S" });
    await setProfileProxy({
      id: p.id,
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    await expect(
      setProfileProxy({
        id: p.id,
        proxy: { type: "socks5", host: "h.example", port: 1080 },
      }),
    ).rejects.toThrow(/SOCKS5/);
    const ok = await setProfileProxy({
      id: p.id,
      proxy: { type: "socks5", host: "h.example", port: 1080 },
      auth: null,
    });
    expect(ok.proxy).toMatchObject({ type: "socks5", hasAuth: false });
    expect(state.keychain.has(KEY(p.id))).toBe(false);
  });

  it("omitted auth keeps stored creds and re-pushes them to main", async () => {
    const p = await createProfile({ name: "K" });
    await setProfileProxy({
      id: p.id,
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    state.host.length = 0;
    const u = await setProfileProxy({
      id: p.id,
      proxy: { ...HTTP, port: 9090 },
    });
    expect(u.proxy).toMatchObject({ port: 9090, hasAuth: true });
    expect(state.host[0]?.params).toMatchObject({
      auth: { username: "u", password: "p" },
    });
  });

  it("proxy:null clears config, keychain and tells main to go direct", async () => {
    const p = await createProfile({ name: "N" });
    await setProfileProxy({
      id: p.id,
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    state.host.length = 0;
    const u = await setProfileProxy({ id: p.id, proxy: null });
    expect(u.proxy).toBeUndefined();
    expect(state.keychain.size).toBe(0);
    expect(state.host).toEqual([
      {
        method: "browser.setProfileProxy",
        params: { profile: p.id, proxy: null },
      },
    ]);
  });

  it("rejects creds without a proxy, unknown profiles and empty username", async () => {
    const p = await createProfile({ name: "E" });
    await expect(
      setProfileProxy({
        id: p.id,
        proxy: null,
        auth: { username: "u", password: "p" },
      }),
    ).rejects.toThrow(/Credentials/);
    await expect(
      setProfileProxy({ id: "p-deadbeef", proxy: HTTP }),
    ).rejects.toThrow(/not found/);
    await expect(
      setProfileProxy({
        id: p.id,
        proxy: HTTP,
        auth: { username: "", password: "p" },
      }),
    ).rejects.toThrow(/username/);
  });
});

describe("sync + delete", () => {
  it("syncAllProxies pushes every profile (null for direct ones) with keychain creds", async () => {
    const a = await createProfile({ name: "A" });
    const b = await createProfile({ name: "B" });
    await setProfileProxy({
      id: a.id,
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    state.host.length = 0;
    const res = await syncAllProxies();
    expect(res.synced).toBe(3);
    const byProfile = Object.fromEntries(
      state.host.map((h) => [h.params.profile as string, h.params]),
    );
    expect(byProfile[a.id]).toMatchObject({
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    expect(byProfile[b.id]).toEqual({ profile: b.id, proxy: null });
    expect(byProfile.default).toEqual({ profile: "default", proxy: null });
  });

  it("one failed push does not stop the others", async () => {
    await createProfile({ name: "A" });
    state.hostError = new Error("main gone");
    await expect(syncAllProxies()).resolves.toEqual({ synced: 2 });
    expect(state.host).toHaveLength(2);
  });

  it("removeProfile deletes the keychain entry and clears the proxy on main", async () => {
    const p = await createProfile({ name: "D" });
    await setProfileProxy({
      id: p.id,
      proxy: HTTP,
      auth: { username: "u", password: "p" },
    });
    state.host.length = 0;
    await removeProfile(p.id);
    expect(state.keychain.has(KEY(p.id))).toBe(false);
    expect(state.host.map((h) => h.method)).toEqual([
      "browser.setProfileProxy",
      "browser.wipeProfile",
    ]);
    expect(state.host[0]?.params).toEqual({ profile: p.id, proxy: null });
  });
});
