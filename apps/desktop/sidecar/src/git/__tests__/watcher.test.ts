import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Test tích hợp với watcher THẬT của hệ điều hành trên một repo git thật: sự kiện tới
// từ kernel theo đồng hồ thật nên fake timers không lái được — chờ bằng điều kiện,
// chỉ ngủ cố định ở nhịp khởi động luồng sự kiện và ở ca "KHÔNG có gì xảy ra".

const events: string[] = [];
vi.mock("../../transport/stdio.js", () => ({
  emit: (type: string, payload: { workspaceRoot: string }) => {
    events.push(`${type}:${payload.workspaceRoot}`);
  },
}));

const { attachGitWatcher, detachGitWatcher } = await import("../watcher.js");

const root = mkdtempSync(join(tmpdir(), "awog-gitw-"));
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
  });
const changed = () => events.includes(`git:status:changed:${root}`);

const waitFor = async (pred: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(50);
  }
};

describe("git watcher", () => {
  beforeAll(async () => {
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a");
    git("add", ".");
    git("commit", "-qm", "init");
    attachGitWatcher(root);
    // FSEvents cần một nhịp để luồng sự kiện bắt đầu chảy.
    await sleep(400);
  });

  afterAll(async () => {
    await detachGitWatcher(root);
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    events.length = 0;
  });

  it("fires on staging (index)", async () => {
    writeFileSync(join(root, "b.txt"), "b");
    git("add", "b.txt");
    await waitFor(changed);
  });

  it("fires on a deeply nested branch ref", async () => {
    git("branch", "feature/a/b/c/d");
    await waitFor(changed);
  });

  it("ignores writes outside HEAD/index/refs", async () => {
    writeFileSync(join(root, ".git", "description"), "x");
    writeFileSync(join(root, ".git", "objects", "junk"), "x");
    await sleep(800);
    expect(changed()).toBe(false);
  });
});
