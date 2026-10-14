import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test tích hợp với watcher THẬT của hệ điều hành (FSEvents/inotify): sự kiện tới từ
// kernel theo đồng hồ thật nên fake timers không lái được — chờ bằng điều kiện
// (`waitFor`) khi có thể, chỉ ngủ cố định ở nhịp khởi động luồng sự kiện và ở ca
// "KHÔNG có gì xảy ra".

const emitted: {
  event: string;
  payload: { workspaceRoot: string; paths: string[] };
}[] = [];
vi.mock("../transport/stdio.js", () => ({
  emit: (
    event: string,
    payload: { workspaceRoot: string; paths: string[] },
  ) => {
    emitted.push({ event, payload });
  },
}));

const { workspaceFsWatcher } = await import("../fs-watcher.js");

const waitFor = async (pred: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(50);
  }
};

describe("workspaceFsWatcher", () => {
  let root: string;

  beforeEach(() => {
    emitted.length = 0;
    root = mkdtempSync(join(tmpdir(), "awog-fsw-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  });

  afterEach(async () => {
    await workspaceFsWatcher.shutdown();
    rmSync(root, { recursive: true, force: true });
  });

  it("emits coalesced workspace-relative paths and drops skipped dirs", async () => {
    await workspaceFsWatcher.watch(root);
    // FSEvents cần một nhịp để luồng sự kiện bắt đầu chảy.
    await sleep(300);
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
    writeFileSync(join(root, "src", "a.ts"), "a");
    await waitFor(() =>
      emitted.some((e) => e.payload.paths.includes("src/a.ts")),
    );
    const all = emitted.flatMap((e) => e.payload.paths);
    expect(
      emitted.every(
        (e) => e.event === "fs:changed" && e.payload.workspaceRoot === root,
      ),
    ).toBe(true);
    expect(all.some((p) => p.startsWith("node_modules"))).toBe(false);
  });

  it("keeps a shared watcher alive until the last unwatch", async () => {
    await workspaceFsWatcher.watch(root);
    await workspaceFsWatcher.watch(root);
    await workspaceFsWatcher.unwatch(root);
    await sleep(300);
    writeFileSync(join(root, "src", "b.ts"), "b");
    await waitFor(() =>
      emitted.some((e) => e.payload.paths.includes("src/b.ts")),
    );

    await workspaceFsWatcher.unwatch(root);
    emitted.length = 0;
    writeFileSync(join(root, "src", "c.ts"), "c");
    await sleep(800);
    expect(emitted).toEqual([]);
  });
});
