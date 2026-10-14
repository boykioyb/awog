import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// Test tích hợp với watcher THẬT của hệ điều hành: sự kiện tới từ kernel theo đồng
// hồ thật nên fake timers không lái được — chờ bằng điều kiện, chỉ ngủ cố định ở
// nhịp khởi động luồng sự kiện và ở ca "KHÔNG có gì xảy ra".

const events: string[] = [];
vi.mock("../transport/stdio.js", () => ({
  emit: (type: string) => {
    events.push(type);
  },
}));

const home = mkdtempSync(join(tmpdir(), "awog-watch-home-"));
const prevHome = process.env.HOME;
const prevClaude = process.env.CLAUDE_CONFIG_DIR;
process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
mkdirSync(join(home, ".awog", "agents"), { recursive: true });
mkdirSync(join(home, ".awog", "wiki"), { recursive: true });

const { awogWatcher } = await import("../watcher.js");

const waitFor = async (pred: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(50);
  }
};

describe("awogWatcher", () => {
  beforeAll(async () => {
    await awogWatcher.start();
    // FSEvents cần một nhịp để luồng sự kiện bắt đầu chảy.
    await sleep(300);
  });

  afterAll(async () => {
    await awogWatcher.shutdown();
    process.env.HOME = prevHome;
    if (prevClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevClaude;
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    events.length = 0;
  });

  it("reports a relevant file change in a watched dir", async () => {
    writeFileSync(join(home, ".awog", "agents", "reviewer.md"), "# r");
    await waitFor(() => events.includes("agents.fs-changed"));
  });

  it("ignores files deeper than the kind allows", async () => {
    // agents: depth 3 ⇒ a/b/c/d/x.md (4 cấp thư mục con) nằm ngoài phạm vi.
    const deep = join(home, ".awog", "agents", "a", "b", "c", "d");
    mkdirSync(deep, { recursive: true });
    await sleep(300);
    events.length = 0;
    writeFileSync(join(deep, "x.md"), "x");
    await sleep(1000);
    expect(events).not.toContain("agents.fs-changed");
  });

  it("follows a nested wiki page within its larger depth", async () => {
    const page = join(home, ".awog", "wiki", "space", "a", "b");
    mkdirSync(page, { recursive: true });
    writeFileSync(join(page, "page.md"), "# p");
    await waitFor(() => events.includes("wiki.fs-changed"));
  });
});
