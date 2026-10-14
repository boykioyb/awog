// Run: npx vitest run src/browser-profiles/__tests__/scope.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../types/shared.js";
import { useTempHome } from "./helpers.js";

type Ref = {
  id: string;
  browserProfileId: string | null;
  projectId: string | null;
  archived: boolean;
};
const state = vi.hoisted(() => ({
  sessions: new Map<
    string,
    {
      id: string;
      browserProfileId: string | null;
      projectId: string | null;
      archived: boolean;
    }
  >(),
  projects: new Map<string, Record<string, unknown>>(),
  tasks: new Map<string, { id: string; projectId: string }>(),
  host: [] as { method: string; params: Record<string, unknown> }[],
  events: [] as { type: string; payload: unknown }[],
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
vi.mock("../../sessions/store.js", () => ({
  getSessionBrowserRef: async (id: string) => state.sessions.get(id),
  listSessionBrowserRefs: async (): Promise<Ref[]> => [
    ...state.sessions.values(),
  ],
  setSessionBrowserProfile: async (id: string, profileId: string | null) => {
    const s = state.sessions.get(id);
    if (!s) return false;
    s.browserProfileId = profileId;
    return true;
  },
}));
vi.mock("../../projects/store.js", () => ({
  loadProject: async (id: string) => state.projects.get(id) ?? null,
  listProjects: async () => [...state.projects.values()],
  saveProject: async (p: Project) => {
    state.projects.set(p.id, p as unknown as Record<string, unknown>);
  },
}));
vi.mock("../../tasks/store.js", () => ({
  loadTask: async (id: string) => state.tasks.get(id) ?? null,
}));

import {
  changeDefaultProfile,
  pushScopeProfile,
  removeProfile,
  resolveScopeProfile,
  resyncProjectScopes,
} from "../scope.js";
import { createProfile, listProfiles } from "../profiles.js";

let cleanup: () => Promise<void>;
beforeEach(async () => {
  cleanup = await useTempHome();
  state.sessions.clear();
  state.projects.clear();
  state.tasks.clear();
  state.host.length = 0;
  state.events.length = 0;
  state.hostError = null;
});
afterEach(async () => {
  await cleanup();
});

const session = (
  id: string,
  browserProfileId: string | null,
  projectId: string | null,
): void => {
  state.sessions.set(id, { id, browserProfileId, projectId, archived: false });
};

describe("resolveScopeProfile", () => {
  it("no scope / unknown scope → default profile", async () => {
    expect(await resolveScopeProfile(undefined)).toBe("default");
    expect(await resolveScopeProfile("")).toBe("default");
    expect(await resolveScopeProfile("ses-unknown")).toBe("default");
    expect(await resolveScopeProfile("task:missing:n1")).toBe("default");
  });

  it("follows the app default when it is changed", async () => {
    const p = await createProfile({ name: "D" });
    await changeDefaultProfile(p.id);
    expect(await resolveScopeProfile(undefined)).toBe(p.id);
    session("s1", null, null);
    expect(await resolveScopeProfile("s1")).toBe(p.id);
  });

  it("session → project → default precedence", async () => {
    const a = await createProfile({ name: "A" });
    const b = await createProfile({ name: "B" });
    state.projects.set("proj", { id: "proj", browserProfileId: a.id });
    session("s-none", null, "proj");
    session("s-over", b.id, "proj");
    session("s-noproj", null, null);
    session("s-proj-nopref", null, "other");
    state.projects.set("other", { id: "other" });
    expect(await resolveScopeProfile("s-over")).toBe(b.id);
    expect(await resolveScopeProfile("s-none")).toBe(a.id);
    expect(await resolveScopeProfile("s-noproj")).toBe("default");
    expect(await resolveScopeProfile("s-proj-nopref")).toBe("default");
  });

  it("task:<id>[:node] → the task project profile, else default", async () => {
    const a = await createProfile({ name: "A" });
    state.projects.set("proj", { id: "proj", browserProfileId: a.id });
    state.projects.set("plain", { id: "plain" });
    state.tasks.set("t1", { id: "t1", projectId: "proj" });
    state.tasks.set("t2", { id: "t2", projectId: "plain" });
    expect(await resolveScopeProfile("task:t1:node-1")).toBe(a.id);
    expect(await resolveScopeProfile("task:t1")).toBe(a.id);
    expect(await resolveScopeProfile("task:t2:node-1")).toBe("default");
  });

  it("ignores references to a profile that no longer exists", async () => {
    session("s1", "p-deadbeef", "proj");
    state.projects.set("proj", { id: "proj", browserProfileId: "p-cafebabe" });
    expect(await resolveScopeProfile("s1")).toBe("default");
  });
});

describe("pushScopeProfile / resync", () => {
  it("pushes browser.setScopeProfile with the resolved profile", async () => {
    const a = await createProfile({ name: "A" });
    session("s1", a.id, null);
    await pushScopeProfile("s1");
    expect(state.host).toEqual([
      {
        method: "browser.setScopeProfile",
        params: { scope: "s1", profile: a.id },
      },
    ]);
  });

  it("never throws when the host request fails", async () => {
    state.hostError = new Error("no host");
    await expect(pushScopeProfile("s1")).resolves.toBeUndefined();
  });

  it("resyncProjectScopes pushes only non-overridden, non-archived sessions of the project", async () => {
    const a = await createProfile({ name: "A" });
    state.projects.set("proj", { id: "proj", browserProfileId: a.id });
    session("inherits", null, "proj");
    session("overrides", a.id, "proj");
    session("elsewhere", null, "other");
    state.sessions.set("old", {
      id: "old",
      browserProfileId: null,
      projectId: "proj",
      archived: true,
    });
    await resyncProjectScopes("proj");
    expect(state.host.map((h) => h.params.scope)).toEqual(["inherits"]);
  });
});

describe("removeProfile", () => {
  it("clears session/project references, resyncs, then wipes the partition", async () => {
    const a = await createProfile({ name: "A" });
    const keep = await createProfile({ name: "Keep" });
    session("s-a", a.id, null);
    session("s-keep", keep.id, null);
    state.projects.set("proj", {
      id: "proj",
      name: "P",
      browserProfileId: a.id,
    });
    state.projects.set("proj2", {
      id: "proj2",
      name: "P2",
      browserProfileId: keep.id,
    });

    await removeProfile(a.id);

    expect(state.sessions.get("s-a")?.browserProfileId).toBeNull();
    expect(state.sessions.get("s-keep")?.browserProfileId).toBe(keep.id);
    expect(state.projects.get("proj")).not.toHaveProperty("browserProfileId");
    expect(state.projects.get("proj2")?.browserProfileId).toBe(keep.id);
    expect((await listProfiles()).profiles.map((p) => p.id)).not.toContain(
      a.id,
    );

    const methods = state.host.map((h) => h.method);
    expect(methods[methods.length - 1]).toBe("browser.wipeProfile");
    expect(state.host.at(-1)?.params).toEqual({ profile: a.id });
    expect(
      state.host.find((h) => h.params.scope === "s-a")?.params.profile,
    ).toBe("default");
    expect(
      state.events.some((e) => e.type === "browser.profiles-changed"),
    ).toBe(true);
  });

  it("refuses to delete default and does not wipe anything", async () => {
    await expect(removeProfile("default")).rejects.toThrow(/cannot be deleted/);
    expect(state.host).toEqual([]);
  });

  it("still succeeds when the wipe host request fails", async () => {
    const a = await createProfile({ name: "A" });
    state.hostError = new Error("no host");
    await expect(removeProfile(a.id)).resolves.toMatchObject({
      defaultProfileId: "default",
    });
  });
});
