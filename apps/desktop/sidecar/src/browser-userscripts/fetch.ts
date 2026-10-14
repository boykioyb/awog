// Tải một `.user.js` qua https cho `userscripts.importUrl`. URL do người dùng dán
// (L1) nên đi qua cùng cổng SSRF với WebFetch/browser_tool: protocol + host literal
// + DNS-resolve từng IP (`assertSafeUrl`), lặp lại ở MỖI hop redirect (đi tay,
// tối đa 3, và hop nào cũng phải https). Giới hạn 512KB và 15s.

import { assertSafeUrl } from "../runtime/tools/ssrf.js";
import { MAX_SOURCE_BYTES } from "./store.js";
import { UserscriptError } from "./meta.js";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_SOURCE_BYTES)
    throw new UserscriptError("Script is larger than 512KB");
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_SOURCE_BYTES)
      throw new UserscriptError("Script is larger than 512KB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchUserscriptSource(rawUrl: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let url: URL;
      try {
        url = await assertSafeUrl(current);
      } catch (err) {
        throw new UserscriptError(
          err instanceof Error ? err.message : String(err),
        );
      }
      if (url.protocol !== "https:")
        throw new UserscriptError("Only https:// URLs can be imported");
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          Accept: "text/javascript, application/javascript, text/plain, */*",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location)
          throw new UserscriptError(
            `Redirect without Location (HTTP ${res.status})`,
          );
        current = new URL(location, url).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new UserscriptError(`Download failed: HTTP ${res.status}`);
      }
      return await readCapped(res);
    }
    throw new UserscriptError(`Too many redirects (max ${MAX_REDIRECTS})`);
  } catch (err) {
    if (err instanceof UserscriptError) throw err;
    throw new UserscriptError(
      ctrl.signal.aborted
        ? "Download timed out"
        : `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
