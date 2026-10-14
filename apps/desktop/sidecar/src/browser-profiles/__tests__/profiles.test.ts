// Run: npx vitest run src/browser-profiles/__tests__/profiles.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertProfileId,
  createProfile,
  deleteProfile,
  listProfiles,
  profileDir,
  setDefaultProfile,
  updateProfile,
  MAX_PROFILES,
} from "../profiles.js";
import { useTempHome } from "./helpers.js";

let cleanup: () => Promise<void>;
beforeEach(async () => {
  cleanup = await useTempHome();
});
afterEach(async () => {
  await cleanup();
});

describe("browser profiles store", () => {
  it("always has the default profile, even with no file", async () => {
    const { defaultProfileId, profiles } = await listProfiles();
    expect(defaultProfileId).toBe("default");
    expect(profiles.map((p) => p.id)).toEqual(["default"]);
    expect(profiles[0]?.name).toBe("Mặc định");
  });

  it("cannot delete the default profile", async () => {
    await expect(deleteProfile("default")).rejects.toThrow(/cannot be deleted/);
    expect((await listProfiles()).profiles).toHaveLength(1);
  });

  it("creates with a p-<8hex> id, updates and deletes", async () => {
    const p = await createProfile({ name: "  Work  ", color: "#ff0000" });
    expect(p.id).toMatch(/^p-[0-9a-f]{8}$/);
    expect(p.name).toBe("Work");
    const u = await updateProfile({ id: p.id, name: "Work 2" });
    expect(u).toMatchObject({ id: p.id, name: "Work 2", color: "#ff0000" });
    await deleteProfile(p.id);
    expect((await listProfiles()).profiles.map((x) => x.id)).toEqual([
      "default",
    ]);
  });

  it('setDefault switches the default; deleting it falls back to "default"', async () => {
    const p = await createProfile({ name: "A" });
    await setDefaultProfile(p.id);
    expect((await listProfiles()).defaultProfileId).toBe(p.id);
    const res = await deleteProfile(p.id);
    expect(res.defaultProfileId).toBe("default");
    expect((await listProfiles()).defaultProfileId).toBe("default");
  });

  it("rejects unknown ids and empty names", async () => {
    await expect(setDefaultProfile("p-deadbeef")).rejects.toThrow(/not found/);
    await expect(
      updateProfile({ id: "p-deadbeef", name: "x" }),
    ).rejects.toThrow(/not found/);
    await expect(createProfile({ name: "   " })).rejects.toThrow(/name/);
  });

  it("caps the number of profiles", async () => {
    for (let i = 1; i < MAX_PROFILES; i++)
      await createProfile({ name: `p${i}` });
    await expect(createProfile({ name: "one too many" })).rejects.toThrow(
      /At most/,
    );
  });

  it("rejects path-traversal / malformed profile ids", () => {
    for (const bad of [
      "..",
      "../x",
      "a/b",
      "a\\b",
      ".",
      "",
      "UPPER",
      "x".repeat(33),
      "a b",
      "p_1",
    ]) {
      expect(() => assertProfileId(bad)).toThrow(/Invalid browser profile id/);
      expect(() => profileDir(bad)).toThrow();
    }
    expect(assertProfileId("default")).toBe("default");
    expect(assertProfileId("p-0123abcd")).toBe("p-0123abcd");
  });
});
