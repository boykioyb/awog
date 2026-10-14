import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { protocol } from "electron";
import { log } from "./logger";
import { streamFileResponse } from "./media";
import { PREVIEW_SCHEME, parsePreviewUrl, previewMimeOf } from "./preview-url";
import { resolveInsideWorkspace } from "./workspace-scope";

// Custom scheme that renders a workspace HTML file like a browser would, inside a
// sandboxed <iframe> in the Workbench (DocFile "Xem trước"). The URL is PATH-style so
// the page's relative assets (css / js / img next to the file) resolve naturally:
//   wspreview://<token>/<workspace-relative path>
// `<token>` is an opaque random id minted by main (`preview:token` IPC) for one
// canonical workspace root. The renderer never puts a filesystem root in the URL.
//
// Security (invariant #2): every request is resolved via resolveInsideWorkspace
// (realpath → traversal + symlink escape → 403) before a byte is read. The iframe is
// sandboxed WITHOUT allow-same-origin, so the previewed page's JS runs in an opaque
// origin and can't reach the app. No CSP is added on purpose: CDN scripts must load as
// in a normal browser. Subframe navigation to http(s) stays blocked by window.ts.

const MAX_TOKENS = 64;

// token → canonical root, insertion-ordered so the oldest is evicted past MAX_TOKENS.
const tokenToRoot = new Map<string, string>();
const rootToToken = new Map<string, string>();

// Mint (or reuse) the opaque token for a workspace root. The root must be an existing
// directory; it is canonicalised so two spellings of one root share a token.
export function mintPreviewToken(root: string): string {
  if (typeof root !== "string" || root === "")
    throw new Error("workspace root is empty");
  const canon = realpathSync(root);
  if (!statSync(canon).isDirectory())
    throw new Error("workspace root is not a directory");
  const existing = rootToToken.get(canon);
  if (existing) return existing;
  const token = randomBytes(16).toString("hex");
  tokenToRoot.set(token, canon);
  rootToToken.set(canon, token);
  if (tokenToRoot.size > MAX_TOKENS) {
    const oldest = tokenToRoot.keys().next().value;
    if (oldest !== undefined) {
      const oldRoot = tokenToRoot.get(oldest);
      tokenToRoot.delete(oldest);
      if (oldRoot !== undefined) rootToToken.delete(oldRoot);
    }
  }
  return token;
}

// Resolve a request URL to an absolute file path inside its token's root.
//   { status: 200, abs } | { status: 403 | 404 }
export function resolvePreviewRequest(
  rawUrl: string,
): { status: 200; abs: string } | { status: 403 | 404 } {
  const req = parsePreviewUrl(rawUrl);
  if (!req) return { status: 403 };
  const root = tokenToRoot.get(req.token);
  if (!root) return { status: 404 };
  try {
    const abs = resolveInsideWorkspace(root, req.rel);
    if (statSync(abs).isDirectory()) return { status: 404 };
    return { status: 200, abs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { status: 404 };
    log.error(
      `[wspreview] rejected: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: 403 };
  }
}

let registered = false;

// Register the wspreview:// handler. Idempotent; must run after app.whenReady().
export function registerPreviewProtocol(): void {
  if (registered) return;
  registered = true;
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    const res = resolvePreviewRequest(request.url);
    if (res.status !== 200) {
      return new Response(res.status === 404 ? "not found" : "forbidden", {
        status: res.status,
      });
    }
    try {
      return await streamFileResponse(
        res.abs,
        previewMimeOf(res.abs),
        request.headers.get("range"),
      );
    } catch (err) {
      log.error(
        `[wspreview] read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return new Response("not found", { status: 404 });
    }
  });
}
