import { extname, isAbsolute } from "node:path";

// Pure (electron-free, unit-testable) half of the wspreview:// protocol — see
// html-preview.ts for the handler + security notes.
//   wspreview://<token>/<workspace-relative path>
export const PREVIEW_SCHEME = "wspreview";

const EXT_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function previewMimeOf(path: string): string {
  return EXT_MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export type PreviewRequest = { token: string; rel: string };

// Parse `wspreview://<token>/<rel>` into token + workspace-relative path. Returns null
// for anything that must be refused outright: wrong scheme, empty path, NUL byte,
// a `..` segment (even after percent-decoding, e.g. `..%2f`), or a path that is still
// absolute once leading slashes are stripped (drive letters on Windows).
export function parsePreviewUrl(rawUrl: string): PreviewRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${PREVIEW_SCHEME}:` || !url.hostname) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, "");
  if (rel === "" || rel.includes("\0") || isAbsolute(rel)) return null;
  if (rel.split(/[\\/]/).includes("..")) return null;
  return { token: url.hostname, rel };
}
