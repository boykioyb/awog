// Tiện ích ghi file dùng chung cho store profile + bookmark: ghi nguyên tử
// (.tmp + rename) và một hàng đợi tuần tự để hai lần ghi chồng nhau không
// đọc-sửa-ghi đè lên nhau.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  );
}

// null khi file chưa tồn tại; lỗi khác ném tiếp.
export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export async function writeJsonAtomic(
  file: string,
  data: unknown,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

let chain: Promise<unknown> = Promise.resolve();

// Chạy `fn` sau mọi lần ghi trước đó; lỗi của lần trước không chặn lần sau.
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
