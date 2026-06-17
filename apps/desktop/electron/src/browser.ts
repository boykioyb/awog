import { BrowserWindow } from 'electron'
import { engine } from './engine'
import { log } from './logger'

// Embedded-Chromium controller for the agent's `browser_tool` (ADR 0043).
//
// The tool runs in the sidecar (a separate Node process with no Chromium); it
// reaches here via the reverse host-request channel (engine.ts). We drive a
// single dedicated, hidden-by-default BrowserWindow through the high-level
// webContents API (loadURL / executeJavaScript / capturePage) — no raw CDP for
// the lean command set. The window uses its own `persist:awog-browser`
// partition so the agent's browsing is isolated from the app session
// (security invariant #1: no app credentials/cookies leak in).
//
// SSRF: the sidecar runs the authoritative DNS-resolving guard before calling
// us; we add a cheap literal-host re-check here as defense-in-depth AND on
// `will-navigate` (so an in-page click can't bounce the page to an internal
// host) — invariant #7.

const NAV_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 15_000
const EXTRACT_MAX = 200_000

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
]
const LOOPBACK_HOSTS = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1'])

// Returns a rejection reason for a literal host (no DNS), or null if allowed.
function hostBlocked(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'invalid URL'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `protocol ${url.protocol} not allowed (http/https only)`
  }
  const h = url.hostname.toLowerCase()
  if (LOOPBACK_HOSTS.has(h)) return 'loopback host not allowed'
  for (const p of PRIVATE_IP_PATTERNS) {
    if (p.test(h)) return `private/loopback IP ${h} not allowed`
  }
  if (h.includes(':') && (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h))) {
    return `IPv6 private ${h} not allowed`
  }
  return null
}

class BrowserController {
  private win: BrowserWindow | null = null

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      show: false,
      title: 'AWOG Browser',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:awog-browser',
      },
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    // Block in-page navigation to private/loopback hosts (e.g. a malicious link).
    win.webContents.on('will-navigate', (event, url) => {
      const reason = hostBlocked(url)
      if (reason) {
        log.warn('browser will-navigate blocked', { url, reason })
        event.preventDefault()
      }
    })
    // Deny popups / new windows — keep a single controllable surface.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win = win
    return win
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
      ),
    ])
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const reason = hostBlocked(url)
    if (reason) throw new Error(`blocked URL — ${reason}`)
    const win = this.ensureWindow()
    await this.withTimeout(win.webContents.loadURL(url), NAV_TIMEOUT_MS, 'navigation')
    return { url: win.webContents.getURL(), title: win.webContents.getTitle() }
  }

  async click(selector: string): Promise<{ found: boolean }> {
    const win = this.ensureWindow()
    const code = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`
    const found = await this.withTimeout(win.webContents.executeJavaScript(code, true), ACTION_TIMEOUT_MS, 'click')
    return { found: Boolean(found) }
  }

  async fill(selector: string, value: string): Promise<{ found: boolean }> {
    const win = this.ensureWindow()
    const code = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
    const found = await this.withTimeout(win.webContents.executeJavaScript(code, true), ACTION_TIMEOUT_MS, 'fill')
    return { found: Boolean(found) }
  }

  async extract(mode: 'text' | 'dom', selector?: string): Promise<{ content: string }> {
    const win = this.ensureWindow()
    const target = selector
      ? `document.querySelector(${JSON.stringify(selector)})`
      : mode === 'dom'
        ? 'document.documentElement'
        : 'document.body'
    const prop = mode === 'dom' ? 'outerHTML' : 'innerText'
    const code = `(() => { const el = ${target}; return el ? String(el.${prop} || '') : null; })()`
    const raw = await this.withTimeout(win.webContents.executeJavaScript(code, true), ACTION_TIMEOUT_MS, 'extract')
    if (raw === null) throw new Error(selector ? `no element matches ${selector}` : 'no document loaded')
    const text = String(raw)
    return { content: text.length > EXTRACT_MAX ? `${text.slice(0, EXTRACT_MAX)}\n…(truncated)` : text }
  }

  async screenshot(): Promise<{ base64: string; width: number; height: number }> {
    const win = this.ensureWindow()
    const img = await win.webContents.capturePage()
    const size = img.getSize()
    return { base64: img.toPNG().toString('base64'), width: size.width, height: size.height }
  }

  show(): void {
    const win = this.ensureWindow()
    win.show()
    win.focus()
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible())
  }
}

export const browser = new BrowserController()

function asObject(p: unknown): Record<string, unknown> {
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

function requireString(p: unknown, key: string): string {
  const v = asObject(p)[key]
  if (typeof v !== 'string' || v.length === 0) throw new Error(`missing required param: ${key}`)
  return v
}

// Register the browser.* methods the sidecar invokes via hostRequest(). Each
// validates its params (main is also a trust boundary) and returns plain JSON.
export function registerBrowserHostHandlers(): void {
  engine.registerHostHandler('browser.navigate', async (p) => browser.navigate(requireString(p, 'url')))
  engine.registerHostHandler('browser.click', async (p) => browser.click(requireString(p, 'selector')))
  engine.registerHostHandler('browser.fill', async (p) =>
    browser.fill(requireString(p, 'selector'), requireString(p, 'value')),
  )
  engine.registerHostHandler('browser.extract', async (p) => {
    const o = asObject(p)
    const mode = o.mode === 'dom' ? 'dom' : 'text'
    const selector = typeof o.selector === 'string' ? o.selector : undefined
    return browser.extract(mode, selector)
  })
  engine.registerHostHandler('browser.screenshot', async () => browser.screenshot())
  engine.registerHostHandler('browser.show', async () => {
    browser.show()
    return { ok: true }
  })
  engine.registerHostHandler('browser.hide', async () => {
    browser.hide()
    return { ok: true }
  })
}
