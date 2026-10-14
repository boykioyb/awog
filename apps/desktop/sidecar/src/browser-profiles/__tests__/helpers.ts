// HOME tạm cho test store: awogHome() đọc os.homedir() mỗi lần gọi nên đổi HOME là đủ.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function useTempHome(): Promise<() => Promise<void>> {
  const prev = process.env.HOME;
  const dir = await mkdtemp(join(tmpdir(), "awog-bp-"));
  process.env.HOME = dir;
  return async () => {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
    await rm(dir, { recursive: true, force: true });
  };
}
