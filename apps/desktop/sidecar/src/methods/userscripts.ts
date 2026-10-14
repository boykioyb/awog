// RPC userscript của trình duyệt nhúng. Mọi lần ghi phát `userscripts.changed` (UI
// nạp lại) và đẩy tập mới sang Electron main (`browser.setUserscripts`).
// Tài liệu: docs/features/browser-userscripts.md

import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import { emit, hostRequest } from "../transport/stdio.js";
import { log } from "../util/logger.js";
import { UserscriptError } from "../browser-userscripts/meta.js";
import { fetchUserscriptSource } from "../browser-userscripts/fetch.js";
import {
  getUserscriptSource,
  hostSnapshot,
  installUserscript,
  listUserscripts,
  removeUserscript,
  saveUserscript,
  setUserscriptEnabled,
} from "../browser-userscripts/store.js";

const Id = z.string().regex(/^us-[0-9a-f]{8}$/);

// Lỗi nghiệp vụ → -32602 để UI hiện nguyên văn.
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserscriptError) throw new RpcError(-32602, err.message);
    throw err;
  }
}

// Main không nhận được thì tự kéo lại (`userscripts.snapshot`) khi engine khởi động
// lại hoặc app mở: một lần đẩy hụt chỉ log, không được làm hỏng lời gọi ghi.
async function afterWrite(): Promise<void> {
  emit("userscripts.changed", {});
  try {
    await hostRequest("browser.setUserscripts", {
      scripts: await hostSnapshot(),
    });
  } catch (err) {
    log.warn("userscripts: setUserscripts push failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

register("userscripts.list", async () => ({
  scripts: await listUserscripts(),
}));

register("userscripts.get", async (raw) => {
  const { id } = z.object({ id: Id }).parse(raw);
  return guarded(async () => ({ id, source: await getUserscriptSource(id) }));
});

// Main kéo tập đầy đủ (luật đã biên dịch + source của script bật).
register("userscripts.snapshot", async () => ({
  scripts: await hostSnapshot(),
}));

register("userscripts.save", async (raw) => {
  const { id, source } = z
    .object({ id: Id.optional(), source: z.string() })
    .parse(raw);
  const item = await guarded(() =>
    saveUserscript({ source, ...(id !== undefined ? { id } : {}) }),
  );
  await afterWrite();
  return item;
});

register("userscripts.setEnabled", async (raw) => {
  const { id, enabled } = z.object({ id: Id, enabled: z.boolean() }).parse(raw);
  const item = await guarded(() => setUserscriptEnabled(id, enabled));
  await afterWrite();
  return item;
});

register("userscripts.remove", async (raw) => {
  const { id } = z.object({ id: Id }).parse(raw);
  await guarded(() => removeUserscript(id));
  await afterWrite();
  return { ok: true };
});

register("userscripts.importUrl", async (raw) => {
  const { url } = z.object({ url: z.string().min(1).max(2000) }).parse(raw);
  const item = await guarded(async () =>
    installUserscript(await fetchUserscriptSource(url.trim())),
  );
  await afterWrite();
  return item;
});
