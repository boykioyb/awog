import { BrowserWindow } from 'electron'
import { engine } from './engine'
import { log } from './logger'

// Embedded-Chromium controller for the agent's `browser_tool` (ADR 0043).
//
// The tool runs in the sidecar (a separate Node process with no Chromium); it
// reaches here via the reverse host-request channel (engine.ts). Each TAB is its
// own dedicated BrowserWindow, hidden by default, all sharing the
// `persist:awog-browser` partition so cookies/storage are shared between tabs the
// way a real browser does — while staying isolated from the app session (security
// invariant #1: no app credentials/cookies leak in).
//
// Why one window per tab instead of WebContentsView children of a single shell:
// the whole surface is headless-by-default and driven programmatically, so the
// only thing a tab strip would buy is chrome we do not draw. A window per tab
// keeps `capturePage` on a hidden surface working exactly as it did before, keeps
// the console/network/debugger plumbing per-webContents with no visibility
// juggling, and costs one `show()`/`hide()` line. See docs/features/browser-tool.md.
//
// Beyond loadURL/executeJavaScript/capturePage we attach the Chrome DevTools
// Protocol (`webContents.debugger`) per tab for the two things the high-level API
// cannot do: recording network requests with retrievable response bodies, and
// device emulation (viewport + touch + UA). Everything degrades gracefully when
// the attach fails — the tab still browses, those two actions report unavailable.
//
// SSRF: the sidecar runs the authoritative DNS-resolving guard before calling us;
// we add a cheap literal-host re-check here as defense-in-depth AND on
// `will-navigate` (so an in-page click can't bounce the page to an internal host)
// — invariant #7.
//
// SECRETS: request/response headers are filtered HERE, at the source, before the
// record ever leaves the main process (SENSITIVE_HEADER_RE). The sidecar then runs
// the shared redactor over what is left. A "show me the network tab" action must
// not become a token export channel.

const NAV_TIMEOUT_MS = 30_000
const ACTION_TIMEOUT_MS = 15_000
const EXTRACT_MAX = 200_000
const SNAPSHOT_MAX_NODES = 1200
const SNAPSHOT_MAX_CHARS = 60_000
const CONSOLE_RING = 500
const CONSOLE_TEXT_MAX = 2_000
const NETWORK_RING = 300
const NETWORK_BODY_MAX = 40_000
const HEADER_VALUE_MAX = 300
const HEADER_COUNT_MAX = 30
const MAX_TABS = 8

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

// ─── Small unknown-narrowing helpers (CDP payloads are untyped) ─────────────

function asObject(p: unknown): Record<string, unknown> {
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

function readString(o: Record<string, unknown>, key: string): string {
  const v = o[key]
  return typeof v === 'string' ? v : ''
}

function readNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function requireString(p: unknown, key: string): string {
  const v = asObject(p)[key]
  if (typeof v !== 'string' || v.length === 0) throw new Error(`missing required param: ${key}`)
  return v
}

function optionalString(p: unknown, key: string): string | undefined {
  const v = asObject(p)[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function optionalNumber(p: unknown, key: string): number | undefined {
  const v = asObject(p)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// ─── Header filtering (secret containment, applied before the record is kept) ─

// Headers that carry a credential outright. Dropped entirely — not truncated, not
// redacted downstream — so the value never crosses the process boundary at all.
const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|www-authenticate|authentication|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-session-token|x-amz-security-token|x-csrf-token|x-xsrf-token)$/i

function sanitizeHeaders(raw: unknown): { headers: Record<string, string>; hidden: number } {
  const src = asObject(raw)
  const headers: Record<string, string> = {}
  let hidden = 0
  let kept = 0
  for (const [key, value] of Object.entries(src)) {
    if (SENSITIVE_HEADER_RE.test(key.trim())) {
      hidden += 1
      continue
    }
    if (kept >= HEADER_COUNT_MAX) {
      hidden += 1
      continue
    }
    headers[key] = clip(typeof value === 'string' ? value : String(value), HEADER_VALUE_MAX)
    kept += 1
  }
  return { headers, hidden }
}

// ─── Page-side scripts ──────────────────────────────────────────────────────
//
// Written with string concatenation (never template literals) so the TS template
// literal that carries them has no `${}` of its own to escape.

// Deep element lookup by the snapshot ref stamp — pierces OPEN shadow roots, which
// `document.querySelector` alone cannot. Shared by click/fill.
const FIND_BY_REF_FN = `
function __awogFindByRef(ref) {
  var q = '[data-awog-ref="' + ref + '"]';
  var direct = document.querySelector(q);
  if (direct) return direct;
  var stack = [document];
  while (stack.length) {
    var root = stack.pop();
    var hit = root.querySelector(q);
    if (hit) return hit;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (all[i].shadowRoot) stack.push(all[i].shadowRoot);
  }
  return null;
}`

// Expression that resolves the target element for click/fill.
function targetExpr(target: { selector?: string; ref?: string }): string {
  if (target.ref) return `__awogFindByRef(${JSON.stringify(target.ref)})`
  return `document.querySelector(${JSON.stringify(target.selector ?? '')})`
}

// Accessibility snapshot. Walks the rendered tree and emits a compact indented
// outline: role + accessible name + the few states that change what a click does.
// Every INTERACTIVE element is stamped `data-awog-ref="ref_N"` and its ref printed,
// so the model can act on "the Submit button" by identity instead of by pixel
// coordinates or a brittle CSS path. Stamps from the previous snapshot are cleared
// first — a ref must never resolve to two different nodes across calls.
function snapshotScript(selector: string | undefined, maxNodes: number): string {
  return `(function () {
  var REF = 'data-awog-ref';
  var MAX = ${maxNodes};
  var sel = ${JSON.stringify(selector ?? null)};
  var root = sel ? document.querySelector(sel) : document.body;
  if (!root) return null;
  var old = document.querySelectorAll('[' + REF + ']');
  for (var i = 0; i < old.length; i++) old[i].removeAttribute(REF);

  var SKIP = { script: 1, style: 1, noscript: 1, template: 1, head: 1, meta: 1, link: 1, title: 1, svg: 1 };
  var INTERACTIVE_ROLES = { button: 1, link: 1, checkbox: 1, radio: 1, textbox: 1, searchbox: 1,
    combobox: 1, listbox: 1, option: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1,
    switch: 1, tab: 1, slider: 1, spinbutton: 1 };
  var STRUCTURAL_ROLES = { heading: 1, img: 1, navigation: 1, main: 1, banner: 1, contentinfo: 1,
    complementary: 1, form: 1, search: 1, dialog: 1, alertdialog: 1, alert: 1, article: 1,
    region: 1, table: 1, status: 1 };
  var TAG_ROLES = { nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
    aside: 'complementary', form: 'form', article: 'article', section: 'region', dialog: 'dialog',
    table: 'table', img: 'img' };

  function squash(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function cut(s, n) { return s.length > n ? s.slice(0, n) + '\\u2026' : s; }

  function roleOf(el) {
    var explicit = el.getAttribute('role');
    if (explicit) { var first = explicit.trim().split(/\\s+/)[0]; if (first) return first.toLowerCase(); }
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'option') return 'option';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden') return '';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'file') return 'file-input';
      if (t === 'search') return 'searchbox';
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      return 'textbox';
    }
    return TAG_ROLES[tag] || '';
  }

  function isInteractive(el, role) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
    if (tag === 'input') return (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    if (el.isContentEditable) return true;
    if (INTERACTIVE_ROLES[role]) return true;
    if (el.hasAttribute('onclick')) return true;
    var ti = el.getAttribute('tabindex');
    return ti !== null && ti !== '-1';
  }

  function visible(el) {
    if (typeof el.checkVisibility === 'function') {
      try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch (e) { /* fall through */ }
    }
    var st = el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
    if (!st) return true;
    return st.display !== 'none' && st.visibility !== 'hidden';
  }

  function nameOf(el, allowText) {
    var label = el.getAttribute('aria-label');
    if (label && squash(label)) return squash(label);
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var parts = by.split(/\\s+/).map(function (id) {
        var n = document.getElementById(id);
        return n ? squash(n.textContent) : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') return squash(el.getAttribute('alt') || '');
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.labels && el.labels.length) {
        var lt = [];
        for (var i = 0; i < el.labels.length; i++) lt.push(squash(el.labels[i].textContent));
        var joined = lt.filter(Boolean).join(' ');
        if (joined) return joined;
      }
      var ph = el.getAttribute('placeholder');
      if (ph && squash(ph)) return squash(ph);
      var ttl = el.getAttribute('title');
      if (ttl && squash(ttl)) return squash(ttl);
      var nm = el.getAttribute('name');
      return nm ? squash(nm) : '';
    }
    var t2 = el.getAttribute('title');
    if (t2 && squash(t2)) return squash(t2);
    // Only walk text for small/labelled nodes: innerText of a landmark is the page.
    return allowText ? squash(el.textContent) : '';
  }

  function describe(el, role) {
    var tag = el.tagName.toLowerCase();
    var allowText = role === 'heading' || INTERACTIVE_ROLES[role] === 1 || tag === 'a' ||
      tag === 'button' || tag === 'summary';
    var name = cut(nameOf(el, allowText), 120);
    var out = (role || tag) + (name ? ' ' + JSON.stringify(name) : '');
    if (/^h[1-6]$/.test(tag)) out += ' level=' + tag.charAt(1);
    if (tag === 'a') {
      var href = el.getAttribute('href');
      if (href) out += ' href=' + JSON.stringify(cut(squash(href), 120));
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') out += ' value="***"';
      else {
        var val = squash(el.value);
        if (val) out += ' value=' + JSON.stringify(cut(val, 80));
      }
      if (el.checked === true) out += ' checked';
      if (el.required === true) out += ' required';
    }
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') out += ' disabled';
    var exp = el.getAttribute('aria-expanded');
    if (exp) out += ' expanded=' + exp;
    var cur = el.getAttribute('aria-current');
    if (cur) out += ' current=' + cur;
    var sel2 = el.getAttribute('aria-selected');
    if (sel2) out += ' selected=' + sel2;
    return out;
  }

  function directText(el) {
    var buf = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) buf += n.nodeValue;
    }
    return squash(buf);
  }

  function kidsOf(el) {
    var out = [];
    if (el.shadowRoot) for (var i = 0; i < el.shadowRoot.children.length; i++) out.push(el.shadowRoot.children[i]);
    for (var j = 0; j < el.children.length; j++) out.push(el.children[j]);
    if (el.tagName.toLowerCase() === 'iframe') {
      // Same-origin frames only; a cross-origin access throws and is skipped.
      try { if (el.contentDocument && el.contentDocument.body) out.push(el.contentDocument.body); } catch (e) { /* cross-origin */ }
    }
    return out;
  }

  var lines = [];
  var refSeq = 0;
  var emitted = 0;
  var truncated = false;

  function push(depth, text) {
    if (emitted >= MAX) { truncated = true; return false; }
    var pad = '';
    var d = depth > 12 ? 12 : depth;
    for (var i = 0; i < d; i++) pad += '  ';
    lines.push(pad + '- ' + text);
    emitted++;
    return true;
  }

  function walk(el, depth) {
    if (emitted >= MAX) { truncated = true; return; }
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (!tag || SKIP[tag]) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;
    if (!visible(el)) return;
    var role = roleOf(el);
    var interactive = isInteractive(el, role);
    var depthNext = depth;
    if (interactive) {
      refSeq++;
      var ref = 'ref_' + refSeq;
      el.setAttribute(REF, ref);
      push(depth, describe(el, role || 'element') + ' [' + ref + ']');
      depthNext = depth + 1;
    } else if (STRUCTURAL_ROLES[role]) {
      push(depth, describe(el, role));
      depthNext = depth + 1;
    }
    if (!interactive) {
      var own = directText(el);
      if (own) push(depthNext, 'text ' + JSON.stringify(cut(own, 200)));
    }
    var kids = kidsOf(el);
    for (var i = 0; i < kids.length; i++) walk(kids[i], depthNext);
  }

  walk(root, 0);
  return {
    text: lines.join('\\n'),
    nodes: emitted,
    refs: refSeq,
    truncated: truncated,
    url: location.href,
    title: document.title,
  };
})()`
}

// ─── Per-tab state ──────────────────────────────────────────────────────────

interface ConsoleEntry {
  seq: number
  level: string
  text: string
  source: string
  line: number
  at: number
}

interface NetworkEntry {
  id: string
  method: string
  url: string
  resourceType: string
  status: number | null
  statusText: string
  mimeType: string
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  hiddenHeaders: number
  bytes: number | null
  error: string | null
  state: 'pending' | 'done' | 'failed'
  startedAt: number
}

interface BrowserTab {
  id: string
  win: BrowserWindow
  console: ConsoleEntry[]
  consoleSeq: number
  network: NetworkEntry[]
  networkById: Map<string, NetworkEntry>
  debuggerOk: boolean
}

const CONSOLE_LEVELS = ['verbose', 'info', 'warning', 'error'] as const

export interface TabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
  loading: boolean
}

export interface ViewportInput {
  preset?: string
  width?: number
  height?: number
  mobile?: boolean
}

const VIEWPORT_PRESETS: Record<
  string,
  { width: number; height: number; scale: number; mobile: boolean; ua?: string }
> = {
  mobile: {
    width: 390,
    height: 844,
    scale: 3,
    mobile: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  tablet: {
    width: 820,
    height: 1180,
    scale: 2,
    mobile: true,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  desktop: { width: 1280, height: 800, scale: 1, mobile: false },
  wide: { width: 1680, height: 1050, scale: 1, mobile: false },
}

class BrowserController {
  private tabs = new Map<string, BrowserTab>()
  private activeId: string | null = null
  private tabSeq = 0

  // ── Tab lifecycle ────────────────────────────────────────────────────────

  private createTab(): BrowserTab {
    if (this.tabs.size >= MAX_TABS) {
      throw new Error(`too many browser tabs open (max ${MAX_TABS}) — close one first`)
    }
    this.tabSeq += 1
    const id = `tab_${this.tabSeq}`
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      title: `AWOG Browser — ${id}`,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:awog-browser',
      },
    })
    const tab: BrowserTab = {
      id,
      win,
      console: [],
      consoleSeq: 0,
      network: [],
      networkById: new Map(),
      debuggerOk: false,
    }
    win.on('closed', () => {
      this.tabs.delete(id)
      if (this.activeId === id) this.activeId = this.tabs.keys().next().value ?? null
    })
    // Chặn điều hướng tới host nội bộ/loopback. BA sự kiện, không phải một:
    //
    //   will-navigate       — điều hướng do trang khởi xướng ở khung chính
    //   will-redirect       — hop 3xx; `will-navigate` KHÔNG phát cho nó
    //   will-frame-navigate — khung con; từ Electron 25 `will-navigate` bỏ qua iframe
    //
    // Thiếu hai cái sau thì cổng SSRF chỉ kiểm URL ĐẦU TIÊN: một trang trả
    // `302 Location: http://127.0.0.1:11434/...`, hoặc nhúng một iframe trỏ vào
    // LAN, là đọc được dịch vụ nội bộ của người dùng rồi tuồn ra qua lần
    // `navigate` kế tiếp. `assertSafeUrl` phía sidecar chạy một lần trước khi
    // tải, nên nó không thể là lớp duy nhất — chính comment của ssrf.ts nói
    // "chạy lại ở mỗi hop".
    const guardNav = (event: { preventDefault: () => void }, url: string, where: string): void => {
      const reason = hostBlocked(url)
      if (!reason) return
      log.warn('browser navigation blocked', { url, reason, where })
      event.preventDefault()
    }
    win.webContents.on('will-navigate', (event, url) => guardNav(event, url, 'will-navigate'))
    win.webContents.on('will-redirect', (event, url) => guardNav(event, url, 'will-redirect'))
    win.webContents.on('will-frame-navigate', (details) =>
      guardNav(details, details.url, 'will-frame-navigate'),
    )
    // Deny popups / new windows — a tab is only ever created on request.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Trang web ở đây là L1 tuyệt đối và cửa sổ này ẩn: không có handler thì
    // Electron DUYỆT MẶC ĐỊNH mọi yêu cầu quyền, nên một trang xin clipboard
    // (thường chứa mật khẩu/API key), vị trí, hay notification đều được cấp im
    // lặng. Từ chối tất cả; cần quyền nào sau này thì allowlist đúng cái đó.
    const ses = win.webContents.session
    ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    // Trang không được tự tải file về máy người dùng.
    ses.on('will-download', (event) => {
      log.warn('browser download blocked')
      event.preventDefault()
    })
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      this.pushConsole(tab, level, message, line, sourceId)
    })
    this.attachDebugger(tab)
    this.tabs.set(id, tab)
    this.activeId = id
    return tab
  }

  private tab(tabId?: string): BrowserTab {
    if (tabId) {
      const found = this.tabs.get(tabId)
      if (!found || found.win.isDestroyed()) throw new Error(`no such browser tab: ${tabId}`)
      return found
    }
    const active = this.activeId ? this.tabs.get(this.activeId) : undefined
    if (active && !active.win.isDestroyed()) return active
    return this.createTab()
  }

  // ── Console capture ──────────────────────────────────────────────────────

  private pushConsole(
    tab: BrowserTab,
    level: number,
    message: string,
    line: number,
    sourceId: string,
  ): void {
    tab.consoleSeq += 1
    tab.console.push({
      seq: tab.consoleSeq,
      level: CONSOLE_LEVELS[level] ?? 'info',
      text: clip(String(message ?? ''), CONSOLE_TEXT_MAX),
      source: clip(String(sourceId ?? ''), 200),
      line: typeof line === 'number' ? line : 0,
      at: Date.now(),
    })
    if (tab.console.length > CONSOLE_RING) tab.console.splice(0, tab.console.length - CONSOLE_RING)
  }

  // ── CDP: network recording + device emulation ────────────────────────────

  private attachDebugger(tab: BrowserTab): void {
    const wc = tab.win.webContents
    try {
      wc.debugger.attach('1.3')
    } catch (err) {
      // DevTools already open, or the platform refused. Browsing still works;
      // `network` / `viewport` report the degradation instead of lying.
      log.warn('browser debugger attach failed', {
        tab: tab.id,
        err: err instanceof Error ? err.message : String(err),
      })
      return
    }
    tab.debuggerOk = true
    wc.debugger.on('detach', () => {
      tab.debuggerOk = false
    })
    wc.debugger.on('message', (_event, method: string, params: unknown) => {
      this.onCdpEvent(tab, method, asObject(params))
    })
    void wc.debugger
      .sendCommand('Network.enable', {
        maxTotalBufferSize: 16_000_000,
        maxResourceBufferSize: 8_000_000,
      })
      .catch((err: unknown) => {
        log.warn('browser Network.enable failed', {
          tab: tab.id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
  }

  private onCdpEvent(tab: BrowserTab, method: string, params: Record<string, unknown>): void {
    const id = readString(params, 'requestId')
    if (!id) return
    if (method === 'Network.requestWillBeSent') {
      const req = asObject(params.request)
      const { headers, hidden } = sanitizeHeaders(req.headers)
      const entry: NetworkEntry = {
        id,
        method: readString(req, 'method') || 'GET',
        url: clip(readString(req, 'url'), 2_000),
        resourceType: readString(params, 'type') || 'Other',
        status: null,
        statusText: '',
        mimeType: '',
        requestHeaders: headers,
        responseHeaders: {},
        hiddenHeaders: hidden,
        bytes: null,
        error: null,
        state: 'pending',
        startedAt: Date.now(),
      }
      tab.network.push(entry)
      tab.networkById.set(id, entry)
      if (tab.network.length > NETWORK_RING) {
        const dropped = tab.network.splice(0, tab.network.length - NETWORK_RING)
        for (const d of dropped) tab.networkById.delete(d.id)
      }
      return
    }
    const entry = tab.networkById.get(id)
    if (!entry) return
    if (method === 'Network.responseReceived') {
      const res = asObject(params.response)
      const { headers, hidden } = sanitizeHeaders(res.headers)
      entry.status = readNumber(res, 'status')
      entry.statusText = readString(res, 'statusText')
      entry.mimeType = readString(res, 'mimeType')
      entry.responseHeaders = headers
      entry.hiddenHeaders += hidden
      const type = readString(params, 'type')
      if (type) entry.resourceType = type
      return
    }
    if (method === 'Network.loadingFinished') {
      entry.bytes = readNumber(params, 'encodedDataLength')
      entry.state = 'done'
      return
    }
    if (method === 'Network.loadingFailed') {
      entry.error = readString(params, 'errorText') || 'failed'
      entry.state = 'failed'
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
      ),
    ])
  }

  private run(tab: BrowserTab, code: string, label: string): Promise<unknown> {
    return this.withTimeout(
      tab.win.webContents.executeJavaScript(code, true),
      ACTION_TIMEOUT_MS,
      label,
    )
  }

  async navigate(url: string, tabId?: string): Promise<{ url: string; title: string; tabId: string }> {
    const reason = hostBlocked(url)
    if (reason) throw new Error(`blocked URL — ${reason}`)
    const tab = this.tab(tabId)
    await this.withTimeout(tab.win.webContents.loadURL(url), NAV_TIMEOUT_MS, 'navigation')
    return {
      url: tab.win.webContents.getURL(),
      title: tab.win.webContents.getTitle(),
      tabId: tab.id,
    }
  }

  async click(
    target: { selector?: string; ref?: string },
    tabId?: string,
  ): Promise<{ found: boolean; tabId: string }> {
    const tab = this.tab(tabId)
    const code = `(function () {${FIND_BY_REF_FN}
  var el = ${targetExpr(target)};
  if (!el) return false;
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  if (typeof el.focus === 'function') el.focus();
  el.click();
  return true;
})()`
    const found = await this.run(tab, code, 'click')
    return { found: Boolean(found), tabId: tab.id }
  }

  async fill(
    target: { selector?: string; ref?: string },
    value: string,
    tabId?: string,
  ): Promise<{ found: boolean; tabId: string }> {
    const tab = this.tab(tabId)
    const code = `(function () {${FIND_BY_REF_FN}
  var el = ${targetExpr(target)};
  if (!el) return false;
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  el.focus();
  if (el.isContentEditable) el.textContent = ${JSON.stringify(value)};
  else el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`
    const found = await this.run(tab, code, 'fill')
    return { found: Boolean(found), tabId: tab.id }
  }

  async extract(
    mode: 'text' | 'dom',
    selector?: string,
    tabId?: string,
  ): Promise<{ content: string; tabId: string }> {
    const tab = this.tab(tabId)
    const target = selector
      ? `document.querySelector(${JSON.stringify(selector)})`
      : mode === 'dom'
        ? 'document.documentElement'
        : 'document.body'
    const prop = mode === 'dom' ? 'outerHTML' : 'innerText'
    const code = `(() => { const el = ${target}; return el ? String(el.${prop} || '') : null; })()`
    const raw = await this.run(tab, code, 'extract')
    if (raw === null) throw new Error(selector ? `no element matches ${selector}` : 'no document loaded')
    const text = String(raw)
    return {
      content: text.length > EXTRACT_MAX ? `${text.slice(0, EXTRACT_MAX)}\n…(truncated)` : text,
      tabId: tab.id,
    }
  }

  async snapshot(
    selector?: string,
    tabId?: string,
  ): Promise<{
    text: string
    nodes: number
    refs: number
    truncated: boolean
    url: string
    title: string
    tabId: string
  }> {
    const tab = this.tab(tabId)
    const raw = await this.run(tab, snapshotScript(selector, SNAPSHOT_MAX_NODES), 'snapshot')
    if (raw === null) {
      throw new Error(selector ? `no element matches ${selector}` : 'no document loaded')
    }
    const o = asObject(raw)
    const text = readString(o, 'text')
    const overLimit = text.length > SNAPSHOT_MAX_CHARS
    return {
      text: overLimit ? `${text.slice(0, SNAPSHOT_MAX_CHARS)}\n…(truncated)` : text,
      nodes: readNumber(o, 'nodes') ?? 0,
      refs: readNumber(o, 'refs') ?? 0,
      truncated: o.truncated === true || overLimit,
      url: readString(o, 'url'),
      title: readString(o, 'title'),
      tabId: tab.id,
    }
  }

  async screenshot(tabId?: string): Promise<{
    base64: string
    width: number
    height: number
    tabId: string
  }> {
    const tab = this.tab(tabId)
    const img = await tab.win.webContents.capturePage()
    const size = img.getSize()
    return {
      base64: img.toPNG().toString('base64'),
      width: size.width,
      height: size.height,
      tabId: tab.id,
    }
  }

  readConsole(
    level: string | undefined,
    limit: number,
    tabId?: string,
  ): { entries: ConsoleEntry[]; total: number; tabId: string } {
    const tab = this.tab(tabId)
    const wanted = level && level !== 'all' ? level : null
    const filtered = wanted ? tab.console.filter((e) => e.level === wanted) : tab.console
    return { entries: filtered.slice(-limit), total: filtered.length, tabId: tab.id }
  }

  readNetwork(
    filter: string | undefined,
    limit: number,
    tabId?: string,
  ): { entries: NetworkEntry[]; total: number; available: boolean; tabId: string } {
    const tab = this.tab(tabId)
    const needle = filter ? filter.toLowerCase() : null
    const filtered = needle
      ? tab.network.filter(
          (e) => e.url.toLowerCase().includes(needle) || e.resourceType.toLowerCase() === needle,
        )
      : tab.network
    return {
      entries: filtered.slice(-limit),
      total: filtered.length,
      available: tab.debuggerOk,
      tabId: tab.id,
    }
  }

  async networkBody(
    requestId: string,
    tabId?: string,
  ): Promise<{ body: string; base64: boolean; entry: NetworkEntry | null; tabId: string }> {
    const tab = this.tab(tabId)
    if (!tab.debuggerOk) throw new Error('network recording is not available on this tab')
    const entry = tab.networkById.get(requestId) ?? null
    if (!entry) throw new Error(`no recorded request ${requestId} on ${tab.id}`)
    const res = asObject(
      await this.withTimeout(
        tab.win.webContents.debugger.sendCommand('Network.getResponseBody', { requestId }),
        ACTION_TIMEOUT_MS,
        'network body',
      ),
    )
    const base64 = res.base64Encoded === true
    const body = readString(res, 'body')
    return {
      body: base64 ? '' : clip(body, NETWORK_BODY_MAX),
      base64,
      entry,
      tabId: tab.id,
    }
  }

  async viewport(
    input: ViewportInput,
    tabId?: string,
  ): Promise<{
    width: number
    height: number
    scale: number
    mobile: boolean
    emulated: boolean
    tabId: string
  }> {
    const tab = this.tab(tabId)
    const preset = input.preset ? VIEWPORT_PRESETS[input.preset] : undefined
    if (input.preset && !preset) {
      throw new Error(
        `unknown viewport preset "${input.preset}" — use ${Object.keys(VIEWPORT_PRESETS).join(', ')} or width/height`,
      )
    }
    const width = Math.max(200, Math.min(4000, Math.round(input.width ?? preset?.width ?? 1280)))
    const height = Math.max(200, Math.min(4000, Math.round(input.height ?? preset?.height ?? 800)))
    const mobile = input.mobile ?? preset?.mobile ?? false
    const scale = preset?.scale ?? 1
    tab.win.setContentSize(width, height)
    let emulated = false
    if (tab.debuggerOk) {
      const dbg = tab.win.webContents.debugger
      try {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: scale,
          mobile,
        })
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: mobile })
        await dbg.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: preset?.ua ?? tab.win.webContents.getUserAgent(),
        })
        emulated = true
      } catch (err) {
        log.warn('browser viewport emulation failed', {
          tab: tab.id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { width, height, scale, mobile, emulated, tabId: tab.id }
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  listTabs(): { tabs: TabInfo[]; activeTabId: string | null } {
    const tabs: TabInfo[] = []
    for (const tab of this.tabs.values()) {
      if (tab.win.isDestroyed()) continue
      tabs.push({
        tabId: tab.id,
        url: tab.win.webContents.getURL(),
        title: tab.win.webContents.getTitle(),
        active: tab.id === this.activeId,
        loading: tab.win.webContents.isLoading(),
      })
    }
    return { tabs, activeTabId: this.activeId }
  }

  async newTab(url?: string): Promise<{ tabId: string; url: string; title: string }> {
    const tab = this.createTab()
    if (!url) return { tabId: tab.id, url: '', title: '' }
    const res = await this.navigate(url, tab.id)
    return { tabId: tab.id, url: res.url, title: res.title }
  }

  selectTab(tabId: string): TabInfo {
    const tab = this.tab(tabId)
    this.activeId = tab.id
    if (this.isVisible()) {
      for (const other of this.tabs.values()) {
        if (other.id !== tab.id && !other.win.isDestroyed()) other.win.hide()
      }
      tab.win.show()
      tab.win.focus()
    }
    return {
      tabId: tab.id,
      url: tab.win.webContents.getURL(),
      title: tab.win.webContents.getTitle(),
      active: true,
      loading: tab.win.webContents.isLoading(),
    }
  }

  closeTab(tabId: string): { closed: string; remaining: number } {
    const tab = this.tab(tabId)
    tab.win.destroy()
    this.tabs.delete(tab.id)
    if (this.activeId === tab.id) this.activeId = this.tabs.keys().next().value ?? null
    return { closed: tab.id, remaining: this.tabs.size }
  }

  // ── Window visibility (tray toggle in main.ts) ───────────────────────────

  show(): void {
    const tab = this.tab()
    tab.win.show()
    tab.win.focus()
  }

  hide(): void {
    for (const tab of this.tabs.values()) {
      if (!tab.win.isDestroyed()) tab.win.hide()
    }
  }

  close(): void {
    for (const tab of this.tabs.values()) {
      if (!tab.win.isDestroyed()) tab.win.destroy()
    }
    this.tabs.clear()
    this.activeId = null
  }

  isVisible(): boolean {
    for (const tab of this.tabs.values()) {
      if (!tab.win.isDestroyed() && tab.win.isVisible()) return true
    }
    return false
  }
}

export const browser = new BrowserController()

// Register the browser.* methods the sidecar invokes via hostRequest(). Each
// validates its params (main is also a trust boundary) and returns plain JSON.
export function registerBrowserHostHandlers(): void {
  engine.registerHostHandler('browser.navigate', async (p) =>
    browser.navigate(requireString(p, 'url'), optionalString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.click', async (p) =>
    browser.click(
      { selector: optionalString(p, 'selector'), ref: optionalString(p, 'ref') },
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.fill', async (p) =>
    browser.fill(
      { selector: optionalString(p, 'selector'), ref: optionalString(p, 'ref') },
      requireString(p, 'value'),
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.extract', async (p) => {
    const o = asObject(p)
    const mode = o.mode === 'dom' ? 'dom' : 'text'
    return browser.extract(mode, optionalString(p, 'selector'), optionalString(p, 'tabId'))
  })
  engine.registerHostHandler('browser.screenshot', async (p) =>
    browser.screenshot(optionalString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.snapshot', async (p) =>
    browser.snapshot(optionalString(p, 'selector'), optionalString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.console', async (p) =>
    browser.readConsole(
      optionalString(p, 'level'),
      Math.max(1, Math.min(200, optionalNumber(p, 'limit') ?? 50)),
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.network', async (p) =>
    browser.readNetwork(
      optionalString(p, 'filter'),
      Math.max(1, Math.min(200, optionalNumber(p, 'limit') ?? 50)),
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.networkBody', async (p) =>
    browser.networkBody(requireString(p, 'requestId'), optionalString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.viewport', async (p) =>
    browser.viewport(
      {
        preset: optionalString(p, 'preset'),
        width: optionalNumber(p, 'width'),
        height: optionalNumber(p, 'height'),
        mobile: asObject(p).mobile === true ? true : undefined,
      },
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.tabs', async () => browser.listTabs())
  engine.registerHostHandler('browser.tabNew', async (p) => browser.newTab(optionalString(p, 'url')))
  engine.registerHostHandler('browser.tabSelect', async (p) =>
    browser.selectTab(requireString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.tabClose', async (p) =>
    browser.closeTab(requireString(p, 'tabId')),
  )
  engine.registerHostHandler('browser.show', async () => {
    browser.show()
    return { ok: true }
  })
  engine.registerHostHandler('browser.hide', async () => {
    browser.hide()
    return { ok: true }
  })
}
