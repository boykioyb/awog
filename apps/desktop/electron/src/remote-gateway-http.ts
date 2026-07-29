import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Static file server for the Remote Gateway's PWA (mobile-remote-control, Wave 3).
// The phone loads the PWA over HTTP on the tailnet interface, then upgrades to WS
// on the same origin. Kept tiny + containment-checked (invariant #2): a request
// can only reach files inside the PWA dist dir; anything else → SPA index fallback.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
}

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

// Join `rel` under `root`, returning null if the result escapes `root` (traversal).
function safeJoin(root: string, rel: string): string | null {
  const target = join(root, normalize(rel))
  if (target === root || target.startsWith(root + sep)) return target
  return null
}

export function createStaticHandler(
  rootDir: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  const indexPath = join(rootDir, 'index.html')

  async function tryServe(res: ServerResponse, filePath: string, head: boolean): Promise<boolean> {
    try {
      const data = await readFile(filePath)
      res.writeHead(200, {
        'content-type': mimeFor(filePath),
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(head ? undefined : data)
      return true
    } catch {
      return false
    }
  }

  return (req, res) => {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const head = method === 'HEAD'
    const rawPath = (req.url ?? '/').split('?')[0].split('#')[0]
    let rel = '/'
    try {
      rel = decodeURIComponent(rawPath)
    } catch {
      rel = '/'
    }
    if (rel === '/' || rel === '') rel = 'index.html'

    void (async () => {
      const candidate = safeJoin(rootDir, rel)
      if (candidate && (await tryServe(res, candidate, head))) return
      // SPA fallback: unknown route → index.html (the PWA routes client-side).
      if (await tryServe(res, indexPath, head)) return
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(head ? undefined : 'AWOG remote: PWA build not found')
    })()
  }
}
