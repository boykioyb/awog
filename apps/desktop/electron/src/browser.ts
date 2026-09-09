import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { BrowserWindow, WebContentsView, nativeImage } from 'electron'
import { isHostAllowed, loadSites, saveSites } from './browser-sites'
import { engine } from './engine'
import { log } from './logger'
import { preloadPath } from './paths'
import { applyNavigationGuards, loadAppRoute, WINDOW_BACKGROUND } from './window'
import { resolveInsideWorkspace } from './workspace-scope'

// Embedded-Chromium controller for the agent's `browser_tool` (ADR 0043).
//
// The tool runs in the sidecar (a separate Node process with no Chromium); it
// reaches here via the reverse host-request channel (engine.ts). Each TAB is a
// `WebContentsView`, all sharing the `persist:awog-browser` partition so
// cookies/storage are shared between tabs the way a real browser does — while
// staying isolated from the app session (security invariant #1: no app
// credentials/cookies leak in).
//
// WHY A VIEW AND NOT A WINDOW PER TAB (ADR 0086 revisits this part of ADR 0043).
// The first cut gave each tab its own hidden BrowserWindow because the surface was
// headless-only: a tab strip would have been chrome nobody draws. Now the session
// workspace panel embeds the active tab as a real "Browser" view, and only a
// `WebContentsView` can be parented into an existing window — so the tab model had
// to move. A tab therefore lives in one of three places:
//
//   parked   → child of `holder`, an invisible window (see ensureHolder)
//   embedded → child of the window whose renderer called attach(), at a rect the
//              renderer keeps up to date (WorkspaceBrowser.vue)
//   popout   → child of the standalone window the tray toggle opens
//
// THE ONE THING THE MOVE COSTS, MEASURED. A `WebContentsView` that has never been
// on screen has no compositor surface, so `capturePage` throws
// "Current display surface not available for capture" — where a hidden
// BrowserWindow captured fine. That matters because `screenshot` must keep working
// headless (a task runs with no panel open, ADR 0024 D-7). `ensurePainted` buys the
// surface back: it shows the invisible holder (opacity 0) for one frame, captures,
// hides it again. Once a view has painted, the surface survives hide and reparenting
// — so this happens at most once per tab. In-page timers keep ticking while parked
// only because the view sets `backgroundThrottling: false`.
//
// See docs/features/browser-tool.md + docs/features/session-browser-panel.md.
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
// — invariant #7. Danh sách "site được phép" của người dùng (ADR 0086 phần E,
// browser-sites.ts) là một lớp THÊM trên chính chỗ đó: cùng `hostBlocked`, chạy
// sau guard private/loopback, nên bật hay tắt nó cũng không nới được invariant.
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
// Poll của renderer chạy 1,2 s/lần, nên đọc selection phải thất bại NHANH: 15s là
// hạn cho một hành động người dùng chờ, không phải cho một phép đo nền.
const SELECTION_TIMEOUT_MS = 2_000
// One partition for every tab (cookies/storage shared between tabs like a real
// browser, isolated from the app session — invariant #1). Exported because
// browser-import.ts writes into this exact jar: two string literals would be one
// typo away from importing a profile into a partition nobody reads.
export const BROWSER_PARTITION = 'persist:awog-browser'
// One frame is enough to mint a compositor surface for a view that has never been
// shown; measured at 250ms with margin (see ensurePainted).
const PAINT_FRAME_MS = 250
// Clamp for a rect the RENDERER sends (L1 — see attach/setBounds).
const MAX_VIEW_EDGE = 10_000
// Cap cho ba đường đọc trang của phần E. Script tiêm vào trang đã tự cắt (đỡ
// băng thông IPC) nhưng main VẪN cắt lại: trang là L1, thứ nó TRẢ VỀ không phải
// thứ ta ép được nó trả về, nên cái cắt tính là cái ở đây.
const SELECTION_MAX = 20_000
const PICK_TEXT_MAX = 20_000
const PICK_HTML_MAX = 20_000
const PAGE_CONTEXT_MAX = 8_000

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
//
// ĐÂY LÀ CHỖ DUY NHẤT luật host được thi hành: `navigate`, `openFromUser`,
// `setWindowOpenHandler`, `will-navigate`, `will-redirect`, `will-frame-navigate`
// đều gọi vào đúng hàm này. Danh sách allowlist của người dùng (ADR 0086 phần E)
// vì thế chỉ cần thêm MỘT nhánh ở cuối, sau guard private/loopback — không thêm
// đường rẽ nào, nên không có đường đi nào lọt qua được luật.
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
  // Lớp cuối cùng, và chỉ là lớp THÊM: mọi guard trên vẫn chạy trước ở cả hai
  // chế độ, nên bật/tắt allowlist không bao giờ nới được invariant #7.
  if (!isHostAllowed(h)) return `host ${h} is not in the allowed-sites list`
  return null
}

// Tab đã có document để chạy script chưa?
//
// `executeJavaScript` trên webContents chưa commit document nào KHÔNG reject —
// nó không bao giờ settle. Mọi hàm đọc trang vì thế phải hỏi câu này trước, chứ
// không dựa vào timeout để phát hiện (timeout là lưới cuối, không phải cổng vào).
function hasCommittedPage(wc: Electron.WebContents): boolean {
  const url = wc.getURL()
  return !!url && url !== 'about:blank'
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

function sanitizeHeaders(raw: unknown): {
  headers: Record<string, string>
  hidden: number
} {
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

// ─── Phần E: script đọc trang + element picker (ADR 0086) ───────────────────

// Text người dùng bôi đen trong trang. `window.getSelection()` KHÔNG thấy vùng
// chọn bên trong <input>/<textarea> (nó nằm trong shadow tree của control), nên
// có nhánh dự phòng đọc selectionStart/End — thiếu nó thì bôi đen trong một ô
// nhập của trang trả về rỗng và người dùng không hiểu vì sao.
//
// Giới hạn đã biết, ghi ra để không ai tưởng nó rộng hơn: chỉ khung chính. Vùng
// chọn trong iframe (kể cả same-origin) không thấy; đổi lại không phải quét cây
// frame ở mỗi lần bấm.
//
// Ba script của phần E chỉ trả về TEXT. `url`/`title` main lấy từ `webContents`
// chứ không nhận từ trang: một trang có thể ghi đè `window.location` trong world
// của chính nó, nên "trang này là trang nào" phải do phía tin cậy trả lời.
function selectionScript(max: number): string {
  return `(function () {
  var text = window.getSelection ? String(window.getSelection()) : '';
  if (!text) {
    var el = document.activeElement;
    var tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    if ((tag === 'input' || tag === 'textarea') && typeof el.selectionStart === 'number') {
      text = String(el.value || '').slice(el.selectionStart, el.selectionEnd);
    }
  }
  return text.slice(0, ${max});
})()`
}

// `@page`: url + title + text nhìn thấy được. "Squash" ở đây là bóp khoảng trắng
// NGANG rồi gộp dòng trống liên tiếp, CỐ Ý giữ ngắt đoạn: text này rơi vào
// composer của người dùng, một trang 8k ký tự dồn thành một dòng thì không ai
// đọc nổi và model cũng mất luôn cấu trúc đầu đề/đoạn.
function pageContextScript(max: number): string {
  return `(function () {
  var body = document.body;
  var raw = body ? String(body.innerText || '') : '';
  var text = raw
    .replace(/[ \\t\\u00a0]+/g, ' ')
    .replace(/ *\\n */g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
  return text.slice(0, ${max});
})()`
}

// Element picker. Partition của agent KHÔNG có preload nào (cố ý — thêm một cầu
// vào jar của trang là thêm đúng thứ ADR 0086 muốn tránh), nên kênh trả kết quả
// là GIÁ TRỊ TRẢ VỀ của executeJavaScript: script trả một Promise và Electron
// resolve theo nó. Tay huỷ để lại ở `window.__awogPickCancel` cho main gọi.
//
// Mọi tương tác chuột bị chặn (pointerdown/mousedown/mouseup/click/auxclick/
// dblclick/contextmenu): bấm để CHỌN một cái nút không được đồng thời bấm cái
// nút đó — trên một cái link thì trang điều hướng và cuốn theo cả kết quả.
//
// Selector dựng theo lối "ngắn nhất mà còn duy nhất": #id nếu id duy nhất, còn
// lại bò lên cha, thêm `:nth-of-type` khi trùng thẻ, và DỪNG ngay khi chuỗi đã
// khớp đúng một node — nên nó không phải một đường CSS dài vô ích.
function pickScript(textMax: number, htmlMax: number): string {
  return `(function () {
  var ATTR = 'data-awog-pick';
  if (window.__awogPickCancel) { try { window.__awogPickCancel(); } catch (e) { /* picker cũ */ } }

  var style = document.createElement('style');
  style.textContent = '[' + ATTR + ']{outline:2px solid #10b981 !important;outline-offset:1px !important;}' +
    'html{cursor:crosshair !important;}';
  (document.head || document.documentElement).appendChild(style);

  var EVENTS = ['pointerdown','pointerup','mousedown','mouseup','click','auxclick','dblclick','contextmenu'];
  var hovered = null;
  var settle = null;
  var done = false;
  var promise = new Promise(function (resolve) { settle = resolve; });

  function squash(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function esc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\\\' + c; });
  }
  function unique(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }
  function selectorFor(el) {
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id);
    var parts = [];
    var node = el;
    for (var step = 0; node && node.nodeType === 1 && step < 20; step++) {
      if (node.id && unique('#' + esc(node.id))) { parts.unshift('#' + esc(node.id)); break; }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var same = 0;
        var index = 0;
        for (var i = 0; i < parent.children.length; i++) {
          var kid = parent.children[i];
          if (kid.tagName === node.tagName) { same++; if (kid === node) index = same; }
        }
        if (same > 1) tag += ':nth-of-type(' + index + ')';
      }
      parts.unshift(tag);
      if (!parent || unique(parts.join(' > '))) break;
      node = parent;
    }
    return parts.join(' > ');
  }
  function describe(el) {
    // Gỡ dấu highlight TRƯỚC khi đọc outerHTML: nếu không, cái attribute do
    // picker gắn vào sẽ nằm trong đúng đoạn HTML người dùng mang đi dùng.
    if (el.removeAttribute) el.removeAttribute(ATTR);
    return {
      selector: selectorFor(el),
      text: squash(el.innerText || el.textContent).slice(0, ${textMax}),
      html: String(el.outerHTML || '').slice(0, ${htmlMax})
    };
  }

  function unhighlight() {
    if (hovered && hovered.removeAttribute) hovered.removeAttribute(ATTR);
    hovered = null;
  }
  function teardown() {
    window.removeEventListener('mouseover', onOver, true);
    window.removeEventListener('keydown', onKey, true);
    for (var i = 0; i < EVENTS.length; i++) window.removeEventListener(EVENTS[i], onMouse, true);
    unhighlight();
    if (style.parentNode) style.parentNode.removeChild(style);
    try { delete window.__awogPickCancel; } catch (e) { window.__awogPickCancel = null; }
  }
  function finish(value) {
    if (done) return;
    done = true;
    teardown();
    if (settle) settle(value);
  }
  function onOver(ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1 || el === hovered) return;
    unhighlight();
    hovered = el;
    el.setAttribute(ATTR, '');
  }
  function onMouse(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    if (ev.type !== 'click') return;
    var el = ev.target;
    finish(el && el.nodeType === 1 ? describe(el) : null);
  }
  function onKey(ev) {
    if (ev.key !== 'Escape' && ev.keyCode !== 27) return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(null);
  }

  window.addEventListener('mouseover', onOver, true);
  window.addEventListener('keydown', onKey, true);
  for (var j = 0; j < EVENTS.length; j++) window.addEventListener(EVENTS[j], onMouse, true);
  window.__awogPickCancel = function () { finish(null); };
  return promise;
})()`
}

// Gỡ picker đang treo trong trang. Chạy được cả khi không có picker nào (trang
// vừa điều hướng, world cũ đã mất) — nên main gọi nó vô điều kiện khi dọn.
const PICK_CANCEL_SCRIPT = `(function () {
  if (window.__awogPickCancel) { try { window.__awogPickCancel(); } catch (e) { /* trang đã đổi */ } }
  return true;
})()`

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
  view: WebContentsView
  console: ConsoleEntry[]
  consoleSeq: number
  network: NetworkEntry[]
  networkById: Map<string, NetworkEntry>
  debuggerOk: boolean
  // Has this view ever held a live compositor surface? Gate for capturePage —
  // see ensurePainted, and the header note on what the view model costs.
  painted: boolean
  // Window currently displaying the tab (embedded panel or popout), or null when
  // the tab is parked in the invisible holder.
  host: BrowserWindow | null
}

// Picker đang chờ người dùng bấm. Chỉ có MỘT tại một thời điểm (xem pickElement),
// nên nó là một field của controller chứ không phải map theo tab.
interface PendingPick {
  tabId: string
  // Dọn cả hai phía (listener trong trang + listener trên webContents) rồi
  // resolve promise của `pickElement` bằng null.
  cancel: () => void
}

const CONSOLE_LEVELS = ['verbose', 'info', 'warning', 'error'] as const

export interface TabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
  loading: boolean
  // Renderer chrome (URL bar buttons + "showing elsewhere" placeholder). The
  // sidecar ignores these; they cost nothing to compute and keep one shape.
  canGoBack: boolean
  canGoForward: boolean
  // On screen in the window this list was built FOR (listTabs takes the recipient).
  shown: boolean
  // On screen in some OTHER window — the popout, or a second app window. The panel
  // renders a "showing elsewhere" placeholder instead of fighting for the view,
  // because one webContents cannot be in two rects.
  shownElsewhere: boolean
}

// ADR 0086 phần E. Mirrored in ui-next/types/awog-bridge.d.ts (Awog* names) and in
// preload.ts — three copies because a sandboxed preload cannot import either side.
export interface PageSelection {
  text: string
  url: string
  title: string
}

export interface PickedElement {
  selector: string
  text: string
  html: string
  url: string
  title: string
}

export interface PageContext {
  url: string
  title: string
  text: string
}

export interface SitePolicy {
  mode: 'off' | 'allowlist'
  hosts: string[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// A rect arrives from the renderer (L1). Nothing here can escape a window, but a
// NaN or a 10-million-pixel edge is a native crash surface, so pin every field to
// a sane integer.
function clampRect(rect: Rect): Rect {
  const num = (v: unknown, min: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : min
    return Math.max(min, Math.min(MAX_VIEW_EDGE, n))
  }
  return {
    x: num(rect?.x, -MAX_VIEW_EDGE),
    y: num(rect?.y, -MAX_VIEW_EDGE),
    width: num(rect?.width, 0),
    height: num(rect?.height, 0),
  }
}

// What the user typed in the URL bar. Bare hosts ("example.com") get https://,
// which is also what makes the hostBlocked check meaningful — a string with no
// scheme fails `new URL` and would be reported as "invalid URL" instead of being
// opened. Anything already carrying a scheme is left alone so the guard sees it.
function normalizeUserUrl(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) throw new Error('missing url')
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  return `https://${text}`
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
  // Invisible parent for every tab that is not on screen. See ensureHolder.
  private holder: BrowserWindow | null = null
  // Standalone window for the tray toggle / "pop out" (at most one).
  private popoutWin: BrowserWindow | null = null
  // Renderer subscribers (tab strip + URL bar). Set by the IPC layer, not
  // imported here: this module must not know how the renderer is reached.
  private onChange: (() => void) | null = null
  // Host windows we already watch for close. A child view is destroyed together
  // with its parent window, so a tab embedded in the panel would DIE when the
  // user closes that window — park it first. WeakSet so re-attaching a tab to the
  // same window doesn't stack listeners.
  private hookedHosts = new WeakSet<BrowserWindow>()
  // Element picker đang chờ (ADR 0086 phần E) — tối đa một.
  private pendingPick: PendingPick | null = null

  // ── Where a parked tab lives ─────────────────────────────────────────────

  // A single invisible window that owns every parked view. It exists so a parked
  // tab keeps a real (if hidden) parent: `opacity: 0` + `focusable: false` +
  // ignore-mouse make it unobservable, and it stays `hide()`n except for the one
  // frame `ensurePainted` needs. It is NOT positioned offscreen on purpose —
  // measured: macOS clamps a window at x:-5000 back onto the display, so
  // "park it off the edge" would put a real window on the user's screen.
  private ensureHolder(): BrowserWindow {
    if (this.holder && !this.holder.isDestroyed()) return this.holder
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      frame: false,
      opacity: 0,
      skipTaskbar: true,
      focusable: false,
      title: 'AWOG Browser (parked)',
    })
    win.setIgnoreMouseEvents(true)
    this.holder = win
    return win
  }

  // Park a tab: pull it out of whatever window shows it and hand it to the holder.
  private park(tab: BrowserTab): void {
    const holder = this.ensureHolder()
    if (tab.host && !tab.host.isDestroyed()) tab.host.contentView.removeChildView(tab.view)
    tab.host = null
    holder.contentView.addChildView(tab.view)
    const [w, h] = holder.getContentSize()
    tab.view.setBounds({ x: 0, y: 0, width: w, height: h })
  }

  // capturePage, or null when this view has no display surface to capture. Asking
  // is cheaper and more honest than predicting: `painted` tracks what we know, but
  // a host window the user minimized can take the surface away again.
  private async tryCapture(tab: BrowserTab): Promise<Electron.NativeImage | null> {
    try {
      const img = await tab.view.webContents.capturePage()
      if (img.isEmpty()) return null
      tab.painted = true
      return img
    } catch {
      return null
    }
  }

  // Mint a display surface for a PARKED view by showing the invisible holder for
  // one frame. Measured: a view that has never been composited throws
  // "Current display surface not available for capture", and the surface it gets
  // here outlives hide() and reparenting — so this runs at most once per tab.
  //
  // Only for parked tabs on purpose. If an EMBEDDED tab cannot be captured the
  // host window is hidden or minimized, and stealing the view back to the holder
  // would yank the page out of the panel the user is looking at. Report instead.
  private async primeSurface(tab: BrowserTab): Promise<void> {
    if (tab.host && !tab.host.isDestroyed()) return
    const holder = this.ensureHolder()
    const bounds = tab.view.getBounds()
    holder.setContentSize(Math.max(bounds.width, 800), Math.max(bounds.height, 600))
    const [width, height] = holder.getContentSize()
    tab.view.setBounds({ x: 0, y: 0, width, height })
    holder.showInactive()
    await new Promise((resolve) => setTimeout(resolve, PAINT_FRAME_MS))
    holder.hide()
  }

  // ── Renderer notification ────────────────────────────────────────────────

  setChangeListener(fn: (() => void) | null): void {
    this.onChange = fn
  }

  private changed(): void {
    this.onChange?.()
  }

  // ── Tab lifecycle ────────────────────────────────────────────────────────

  private createTab(): BrowserTab {
    if (this.tabs.size >= MAX_TABS) {
      throw new Error(`too many browser tabs open (max ${MAX_TABS}) — close one first`)
    }
    this.tabSeq += 1
    const id = `tab_${this.tabSeq}`
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: BROWSER_PARTITION,
        // A parked view is inside a hidden window, and Chromium freezes timers in
        // a hidden compositor: measured 0 setInterval ticks parked, 14 with this
        // off. The agent must be able to load a page that finishes rendering after
        // a timeout while nothing is on screen, so the throttle has to go.
        backgroundThrottling: false,
      },
    })
    const tab: BrowserTab = {
      id,
      view,
      console: [],
      consoleSeq: 0,
      network: [],
      networkById: new Map(),
      debuggerOk: false,
      painted: false,
      host: null,
    }
    const wc = view.webContents
    wc.on('destroyed', () => {
      this.tabs.delete(id)
      if (this.activeId === id) this.activeId = this.tabs.keys().next().value ?? null
      this.changed()
    })
    // Anything that changes what the tab strip / URL bar shows. The point of the
    // panel is watching the AGENT browse, so a navigation it triggers has to reach
    // the renderer without the renderer polling for it.
    const notify = (): void => this.changed()
    wc.on('did-navigate', notify)
    wc.on('did-navigate-in-page', notify)
    wc.on('did-start-loading', notify)
    wc.on('did-stop-loading', notify)
    wc.on('page-title-updated', notify)
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
    wc.on('will-navigate', (event, url) => guardNav(event, url, 'will-navigate'))
    wc.on('will-redirect', (event, url) => guardNav(event, url, 'will-redirect'))
    wc.on('will-frame-navigate', (details) => guardNav(details, details.url, 'will-frame-navigate'))
    // `target="_blank"` inside a page. Denying it outright was right while this
    // surface was headless — nobody could see a link fail to do anything. Now the
    // user watches the page in the panel, so a dead click reads as a broken app.
    // Open a real tab instead, through the same SSRF guard as everything else, and
    // still return `deny` so Chromium never creates a window of its own.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && !hostBlocked(url)) {
        void this.newTab(url).catch((err: unknown) => {
          log.warn('browser popup tab failed', {
            err: err instanceof Error ? err.message : String(err),
          })
        })
      } else if (url) {
        log.warn('browser popup blocked', {
          reason: hostBlocked(url) ?? 'non-web scheme',
        })
      }
      return { action: 'deny' }
    })
    // Trang web ở đây là L1 tuyệt đối: không có handler thì
    // Electron DUYỆT MẶC ĐỊNH mọi yêu cầu quyền, nên một trang xin clipboard
    // (thường chứa mật khẩu/API key), vị trí, hay notification đều được cấp im
    // lặng. Từ chối tất cả; cần quyền nào sau này thì allowlist đúng cái đó.
    const ses = wc.session
    ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    // Trang không được tự tải file về máy người dùng.
    ses.on('will-download', (event) => {
      log.warn('browser download blocked')
      event.preventDefault()
    })
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      this.pushConsole(tab, level, message, line, sourceId)
    })
    this.attachDebugger(tab)
    this.tabs.set(id, tab)
    this.activeId = id
    this.park(tab)
    this.changed()
    return tab
  }

  private tab(tabId?: string): BrowserTab {
    if (tabId) {
      const found = this.tabs.get(tabId)
      if (!found || found.view.webContents.isDestroyed()) {
        throw new Error(`no such browser tab: ${tabId}`)
      }
      return found
    }
    const active = this.activeId ? this.tabs.get(this.activeId) : undefined
    if (active && !active.view.webContents.isDestroyed()) return active
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
    const wc = tab.view.webContents
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
        tab.debuggerOk = false
        // Tab chết trước khi CDP trả lời thì KHÔNG phải lỗi, chỉ là thứ tự.
        //
        // `Network.enable` là lệnh async gửi ngay lúc tạo tab; nếu tab bị đóng,
        // cửa sổ chủ bị destroy, hay app đang thoát (`browser.close()`) trong
        // khoảng đó thì lệnh reject với "target closed while handling command".
        // Log warn cho việc này là tiếng ồn thuần: nó không nói người đọc phải làm
        // gì, và nó đến đúng lúc log đang đầy nhất (lúc dọn dẹp). Lỗi attach THẬT
        // — user đang mở DevTools cho tab đó — vẫn phải thấy, nên chỉ im lặng khi
        // đúng là teardown, và hạ xuống `debug` cho ca "target closed" mà
        // webContents vẫn còn sống (đóng đúng lúc, hiếm, vẫn đáng lần lại).
        const message = err instanceof Error ? err.message : String(err)
        if (wc.isDestroyed()) return
        const level = /target closed|Target closed|not attached/i.test(message) ? 'debug' : 'warn'
        log[level]('browser Network.enable failed', { tab: tab.id, err: message })
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

  private run(
    tab: BrowserTab,
    code: string,
    label: string,
    ms = ACTION_TIMEOUT_MS,
  ): Promise<unknown> {
    return this.withTimeout(tab.view.webContents.executeJavaScript(code, true), ms, label)
  }

  async navigate(
    url: string,
    tabId?: string,
  ): Promise<{ url: string; title: string; tabId: string }> {
    const reason = hostBlocked(url)
    if (reason) throw new Error(`blocked URL — ${reason}`)
    const tab = this.tab(tabId)
    await this.withTimeout(tab.view.webContents.loadURL(url), NAV_TIMEOUT_MS, 'navigation')
    return {
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
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
    if (raw === null)
      throw new Error(selector ? `no element matches ${selector}` : 'no document loaded')
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

  // Ảnh của tab, hoặc ném. Bậc thang hai bước ở đây là bắt buộc: một view chưa
  // từng lên màn hình không có compositor surface nên `capturePage` NÉM, và
  // `primeSurface` mint surface đó bằng một frame của holder vô hình rồi thử
  // lại. Dùng chung cho `screenshot` (base64 về cho model) và `saveScreenshot`
  // (ghi PNG vào workspace) — hai đường ra, một cách lấy ảnh.
  // Ảnh của trang, qua ba đường theo thứ tự rẻ → chắc.
  //
  // ĐO ĐƯỢC, VÀ ĐÂY LÀ LÝ DO CÓ ĐƯỜNG THỨ BA: `capturePage` (cả hai đường đầu) đòi
  // một display surface, mà một `WebContentsView` chỉ có surface khi app được window
  // server cho hiện. Điều đó KHÔNG chắc chắn: cùng một mã, cùng một máy, sáng chụp
  // ra PNG 18 413 byte, chiều `primeSurface` không mint được surface nào và cả hai
  // đường đầu ném "no display surface". App chạy mà cửa sổ chưa từng lên foreground
  // là ca đủ thường (khởi động vào tray, task chạy khi máy vừa mở) để không được
  // phép hỏng — nhất là vì đường này là `browser_tool.screenshot` của MODEL.
  //
  // `Page.captureScreenshot` của CDP render từ phía renderer nên không cần surface;
  // debugger đã attach sẵn cho mỗi tab (`debuggerOk`) để ghi network, nên đường lùi
  // này không thêm hạ tầng nào. Nó không thay hai đường trên: khi có surface thì
  // `capturePage` rẻ hơn và đúng những gì đang hiện trên màn hình.
  private async captureOrThrow(tab: BrowserTab): Promise<Electron.NativeImage> {
    let img = await this.tryCapture(tab)
    if (!img) {
      await this.primeSurface(tab)
      img = await this.tryCapture(tab)
    }
    if (!img) img = await this.captureViaCdp(tab)
    if (!img) {
      throw new Error(`cannot screenshot ${tab.id}: no display surface and CDP capture unavailable`)
    }
    return img
  }

  // Đường lùi không cần display surface. `null` khi debugger không attach được
  // (user mở DevTools cho tab đó) hoặc CDP từ chối — người gọi quyết định báo lỗi.
  private async captureViaCdp(tab: BrowserTab): Promise<Electron.NativeImage | null> {
    if (!tab.debuggerOk) return null
    const dbg = tab.view.webContents.debugger
    try {
      // `Page.enable` trước cho chắc: `captureScreenshot` chạy được mà không cần nó
      // trên Chromium hiện tại, nhưng bật domain là idempotent và rẻ.
      await dbg.sendCommand('Page.enable').catch(() => {})
      const res = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
      })
      const data = (res as { data?: unknown }).data
      if (typeof data !== 'string' || !data) return null
      const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
      return img.isEmpty() ? null : img
    } catch (err) {
      log.warn('browser CDP capture failed', {
        tab: tab.id,
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  async screenshot(tabId?: string): Promise<{
    base64: string
    width: number
    height: number
    tabId: string
  }> {
    const tab = this.tab(tabId)
    const img = await this.captureOrThrow(tab)
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
    return {
      entries: filtered.slice(-limit),
      total: filtered.length,
      tabId: tab.id,
    }
  }

  readNetwork(
    filter: string | undefined,
    limit: number,
    tabId?: string,
  ): {
    entries: NetworkEntry[]
    total: number
    available: boolean
    tabId: string
  } {
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
  ): Promise<{
    body: string
    base64: boolean
    entry: NetworkEntry | null
    tabId: string
  }> {
    const tab = this.tab(tabId)
    if (!tab.debuggerOk) throw new Error('network recording is not available on this tab')
    const entry = tab.networkById.get(requestId) ?? null
    if (!entry) throw new Error(`no recorded request ${requestId} on ${tab.id}`)
    const res = asObject(
      await this.withTimeout(
        tab.view.webContents.debugger.sendCommand('Network.getResponseBody', {
          requestId,
        }),
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
    // Sizing the SURFACE so a screenshot matches the emulated metrics. Which
    // window owns that surface depends on where the tab is: parked → the holder
    // (safe to resize, it is invisible); popout → its own window (the user asked
    // for this emulation, so resize it); embedded in the panel → the rect belongs
    // to the renderer's layout, so leave it alone and let CDP emulation carry the
    // metrics on its own.
    this.resizeSurface(tab, width, height)
    let emulated = false
    if (tab.debuggerOk) {
      const dbg = tab.view.webContents.debugger
      try {
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: scale,
          mobile,
        })
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: mobile,
        })
        await dbg.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: preset?.ua ?? tab.view.webContents.getUserAgent(),
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

  // `for` is the window the list is being built for, so `shown` means "in YOUR
  // rect" and `shownElsewhere` means "someone else has it". Omit it (the sidecar
  // path) and `shown` degrades to "on screen anywhere".
  private info(tab: BrowserTab, forWindow?: BrowserWindow): TabInfo {
    const wc = tab.view.webContents
    const host = tab.host && !tab.host.isDestroyed() ? tab.host : null
    return {
      tabId: tab.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      active: tab.id === this.activeId,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      shown: forWindow ? host === forWindow : host !== null,
      shownElsewhere: forWindow ? host !== null && host !== forWindow : false,
    }
  }

  listTabs(forWindow?: BrowserWindow): {
    tabs: TabInfo[]
    activeTabId: string | null
  } {
    const tabs: TabInfo[] = []
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.isDestroyed()) continue
      tabs.push(this.info(tab, forWindow))
    }
    return { tabs, activeTabId: this.activeId }
  }

  // `waitForLoad` quyết định lời gọi này trả về LÚC NÀO, không phải nó làm gì.
  //
  //   true  (mặc định, đường của MODEL) — chờ trang tải xong. `browser_tool` cần
  //         thế: bước sau của agent là `snapshot`/`extract`, mà chụp một trang
  //         chưa tải xong thì trả về rác.
  //   false (đường NGƯỜI DÙNG bấm link) — trả về ngay khi tab đã tạo và điều hướng
  //         đã bắt đầu. Lỗi thật 2026-09-09: renderer await lời gọi này trước khi
  //         mở panel, nên bấm một link tới PR GitHub là ngồi nhìn UI đứng vài giây
  //         rồi trình duyệt mới hiện. Người dùng cần thấy khung + spinner ngay;
  //         trạng thái tải về sau qua event `changed`.
  async newTab(
    url?: string,
    waitForLoad = true,
  ): Promise<{ tabId: string; url: string; title: string }> {
    const tab = this.createTab()
    if (!url) return { tabId: tab.id, url: '', title: '' }
    if (!waitForLoad) {
      // Guard host chạy TRƯỚC và đồng bộ, nên URL bị chặn vẫn ném ngay cho người
      // gọi — chỉ phần tải là không chờ.
      const reason = hostBlocked(url)
      if (reason) throw new Error(`cannot open ${url}: ${reason}`)
      void this.navigate(url, tab.id).catch((err: unknown) => {
        log.warn('browser background navigation failed', {
          tab: tab.id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
      return { tabId: tab.id, url, title: '' }
    }
    const res = await this.navigate(url, tab.id)
    return { tabId: tab.id, url: res.url, title: res.title }
  }

  // Make a tab the active one. "Active" is the tab a tool call with no `tabId`
  // lands on; it is NOT a visibility change any more — a window that is showing
  // some other tab keeps showing it until its renderer asks to attach this one
  // (attachTo). That split is what lets the agent switch tabs mid-turn without
  // yanking the view out from under whoever is watching.
  selectTab(tabId: string): TabInfo {
    const tab = this.tab(tabId)
    this.activeId = tab.id
    this.changed()
    return this.info(tab)
  }

  closeTab(tabId: string): { closed: string; remaining: number } {
    const tab = this.tab(tabId)
    if (tab.host && !tab.host.isDestroyed()) tab.host.contentView.removeChildView(tab.view)
    // `destroyed` on the webContents does the bookkeeping (see createTab).
    tab.view.webContents.close()
    this.tabs.delete(tab.id)
    if (this.activeId === tab.id) this.activeId = this.tabs.keys().next().value ?? null
    this.changed()
    return { closed: tab.id, remaining: this.tabs.size }
  }

  // ── Embedding (the session workspace panel) ──────────────────────────────
  //
  // The renderer owns the rect and asks main to put a tab in it. Main resolves the
  // host window from the IPC sender, never from a payload — a renderer can only
  // ever fill its OWN window (security invariant #4). The rect is L1: clamped here.

  attachTo(host: BrowserWindow, tabId: string | undefined, rect: Rect): TabInfo {
    // `tabId` từ renderer là một BẢN CACHE, và cache thì cũ được: renderer giữ
    // danh sách tab từ event `changed` cuối cùng nó nhận, nên nó hoàn toàn có thể
    // xin `tab_1` sau khi tab đó đã bị đóng (lỗi thật 2026-09-09:
    // `Error invoking remote method 'browser:attach': no such browser tab: tab_1`).
    //
    // `this.tab(id)` NÉM cho một id không còn — đúng cho mọi hành động chỉ định
    // tab (đọc/điều hướng tab nào là ý muốn rõ ràng), nhưng SAI cho `attach`:
    // đây là một yêu cầu HÌNH HỌC ("cho tôi một view vào hình chữ nhật này"), và
    // main là nguồn sự thật. Nên id lạ thì rơi về tab active (tạo mới nếu chưa
    // có) và TabInfo trả về mang id thật để renderer tự sửa mình theo.
    const known = tabId ? this.tabs.get(tabId) : undefined
    const tab = known && !known.view.webContents.isDestroyed() ? known : this.tab()
    // One webContents cannot be in two rects, so attaching hands the tab over:
    // any other window showing it loses it, and any other tab in THIS window is
    // parked. Whoever lost it sees `shown: false` on the next change event and
    // renders the "showing elsewhere" placeholder.
    for (const other of this.tabs.values()) {
      if (other.id !== tab.id && other.host === host) this.park(other)
    }
    if (!this.hookedHosts.has(host)) {
      this.hookedHosts.add(host)
      host.on('close', () => this.detachFrom(host))
    }
    if (tab.host !== host) {
      if (tab.host && !tab.host.isDestroyed()) tab.host.contentView.removeChildView(tab.view)
      const holder = this.holder
      if (holder && !holder.isDestroyed()) holder.contentView.removeChildView(tab.view)
      host.contentView.addChildView(tab.view)
      tab.host = host
    }
    tab.view.setBounds(clampRect(rect))
    tab.painted = true
    this.activeId = tab.id
    this.changed()
    return this.info(tab, host)
  }

  // Follow the panel's layout: scroll, resize, dock change. Bounds-only, so it is
  // cheap enough to call from a ResizeObserver.
  setViewBounds(host: BrowserWindow, tabId: string | undefined, rect: Rect): void {
    const tab = tabId ? this.tabs.get(tabId) : this.activeTab()
    if (!tab || tab.view.webContents.isDestroyed() || tab.host !== host) return
    tab.view.setBounds(clampRect(rect))
  }

  // Take every tab this window shows off screen (tab switched away, panel closed,
  // a modal opened over it, window closing). The page keeps running while parked.
  detachFrom(host: BrowserWindow): void {
    let parked = false
    for (const tab of this.tabs.values()) {
      if (tab.host === host) {
        this.park(tab)
        parked = true
      }
    }
    if (parked) this.changed()
  }

  private activeTab(): BrowserTab | undefined {
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined
    return tab && !tab.view.webContents.isDestroyed() ? tab : undefined
  }

  private resizeSurface(tab: BrowserTab, width: number, height: number): void {
    if (tab.host && !tab.host.isDestroyed()) {
      // Tab đang trên màn hình: rect là việc của renderer đang vẽ nó — kể cả
      // popout, vì popout giờ cũng là một cửa sổ SPA có thanh URL chứ không còn
      // là khung trống bọc một view (xem ensurePopout). Đổi content size của nó
      // theo viewport giả lập sẽ chỉ làm lệch rect renderer vừa gửi; metrics đã
      // do CDP emulation mang, nên để yên là đúng.
      return
    }
    const holder = this.ensureHolder()
    holder.setContentSize(width, height)
    tab.view.setBounds({ x: 0, y: 0, width, height })
  }

  // ── User-driven navigation (URL bar, back/forward/reload) ────────────────
  //
  // Same guard as the agent's `navigate`: a URL typed in the panel is still L1
  // (it can be pasted from model output). `hostBlocked` keeps the loopback/private
  // rule identical for both callers — this is not a back door around invariant #7.

  async openFromUser(url: string, tabId?: string): Promise<TabInfo> {
    const target = normalizeUserUrl(url)
    const reason = hostBlocked(target)
    if (reason) throw new Error(`cannot open ${target}: ${reason}`)
    const tab = this.tab(tabId)
    await this.withTimeout(
      tab.view.webContents.loadURL(target),
      NAV_TIMEOUT_MS,
      'navigation',
    ).catch((err: unknown) => {
      // A failed load leaves the tab usable (error page); report it as data.
      log.warn('browser user navigation failed', {
        url: target,
        err: err instanceof Error ? err.message : String(err),
      })
    })
    this.changed()
    return this.selectTab(tab.id)
  }

  goBack(tabId?: string): void {
    const wc = this.tab(tabId).view.webContents
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(tabId?: string): void {
    const wc = this.tab(tabId).view.webContents
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(tabId?: string): void {
    this.tab(tabId).view.webContents.reload()
  }

  // ── Popout window (tray toggle) ──────────────────────────────────────────
  //
  // Cửa sổ này nạp route `/browser` của SPA, tức nó CÓ chrome: thanh URL,
  // back/forward/reload, tab strip. Bản đầu tiên là một khung trống rồi main tự
  // attach view full-content vào — nên pop out ra là mất sạch thanh URL, không
  // gõ được địa chỉ nào nữa (đúng lỗi người dùng báo). Sửa bằng cách để nó là
  // một cửa sổ SPA bình thường như session popout: cùng `contextIsolation +
  // sandbox + preload`, và view thì do RENDERER của route đó tự attach với rect
  // của chính nó — cơ chế attach theo `event.sender` đã có sẵn, không cần thêm
  // gì. Vì vậy `show()` KHÔNG attach nữa.

  show(): void {
    // Vẫn đảm bảo có ít nhất một tab: mở trình duyệt từ tray mà chưa tab nào là
    // trường hợp bình thường, và renderer cần một tab để attach. Không attach ở
    // đây — đó là việc của renderer.
    this.tab()
    const win = this.ensurePopout()
    win.show()
    win.focus()
  }

  hide(): void {
    if (this.popoutWin && !this.popoutWin.isDestroyed()) this.popoutWin.hide()
  }

  isVisible(): boolean {
    return !!this.popoutWin && !this.popoutWin.isDestroyed() && this.popoutWin.isVisible()
  }

  private ensurePopout(): BrowserWindow {
    if (this.popoutWin && !this.popoutWin.isDestroyed()) return this.popoutWin
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 640,
      minHeight: 480,
      show: false,
      // Khung NATIVE như session popout: đây là một cửa sổ document, và
      // `backgroundColor` chỉ để không loé trắng trước frame đầu của SPA.
      title: 'AWOG Browser',
      backgroundColor: WINDOW_BACKGROUND,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    applyNavigationGuards(win)
    // `close` chứ không `closed`: view con bị phá cùng cửa sổ cha, nên phải park
    // tab TRƯỚC khi cửa sổ biến mất — không thì đóng popout là mất trang.
    win.on('close', () => this.detachFrom(win))
    win.on('closed', () => {
      this.popoutWin = null
      this.changed()
    })
    this.popoutWin = win
    loadAppRoute(win, 'browser')
    return win
  }

  // ── Read + point (ADR 0086 phần E) ───────────────────────────────────────
  //
  // Ba đường đọc trang này trả NỘI DUNG TRANG về cho renderer, thứ phần còn lại
  // của feature cố ý không làm (mọi thứ MODEL đọc đi qua browser_tool phía
  // sidecar, nơi có nonce fence + redactor). Khác nhau ở chỗ AI hỏi: mỗi lời gọi
  // ở đây bắt đầu từ một cú bấm của người dùng trong chrome của trình duyệt, và
  // text hạ cánh trong UI của chính họ — không tự chảy vào prompt.

  async readSelection(tabId?: string): Promise<PageSelection> {
    const tab = this.tab(tabId)
    const wc = tab.view.webContents
    // Tab vừa mở chưa nạp gì: KHÔNG gọi vào renderer.
    //
    // `executeJavaScript` trên một webContents chưa commit document nào không
    // reject — nó KHÔNG BAO GIỜ settle, vì chẳng có world nào nhận lời gọi. Với
    // `readSelection` thì điều đó thành mưa lỗi: renderer poll 1,2 s/lần để biết
    // có nên bật nút dịch/trích, mỗi lời gọi treo tới hết `withTimeout` rồi ném
    // "read selection timed out after 15000ms" (lỗi thật, 2026-09-09, tab
    // `about:blank` trong cửa sổ popout). Không có trang thì không có selection —
    // trả rỗng là câu trả lời ĐÚNG, không phải một cách né lỗi.
    if (!hasCommittedPage(wc)) return { text: '', url: wc.getURL(), title: wc.getTitle() }
    const raw = await this.run(
      tab,
      selectionScript(SELECTION_MAX),
      'read selection',
      SELECTION_TIMEOUT_MS,
    )
    return {
      text: clip(typeof raw === 'string' ? raw : '', SELECTION_MAX),
      url: wc.getURL(),
      title: wc.getTitle(),
    }
  }

  // Arm picker rồi CHỜ người dùng. Không có timeout: "đang chờ một cú bấm" là
  // trạng thái hợp lệ dài bao lâu cũng được. Bù lại nó luôn có đường ra —
  // bấm (kết quả), Esc (null), điều hướng đổi document (null), tab bị đóng
  // (null), `cancelPick` (null) — nên promise này không treo vĩnh viễn.
  //
  // Một picker tại một thời điểm: lời gọi mới HUỶ cái đang chờ (kể cả ở tab
  // khác) thay vì ném, vì hai vùng highlight cùng lúc là thứ người dùng không
  // hiểu, còn một lỗi thì không dạy họ điều gì.
  async pickElement(tabId?: string): Promise<PickedElement | null> {
    const tab = this.tab(tabId)
    this.cancelPick()
    const wc = tab.view.webContents
    return new Promise<PickedElement | null>((resolve) => {
      let settled = false
      const onNav = (details: { isSameDocument: boolean; isMainFrame: boolean }): void => {
        // Chỉ điều hướng ĐỔI DOCUMENT mới giết world của script đã tiêm; đổi
        // hash / pushState thì picker vẫn còn sống nên đừng huỷ hộ người dùng.
        if (details.isSameDocument || !details.isMainFrame) return
        settle(null)
      }
      const onDestroyed = (): void => settle(null)
      // So sánh theo ĐỊNH DANH bản ghi, không theo tabId: hai picker liên tiếp
      // trên cùng một tab thì cái cũ không được phép xoá bản ghi của cái mới.
      const record: PendingPick = { tabId: tab.id, cancel: () => settle(null) }
      const settle = (value: PickedElement | null): void => {
        if (settled) return
        settled = true
        if (this.pendingPick === record) this.pendingPick = null
        wc.removeListener('did-start-navigation', onNav)
        wc.removeListener('destroyed', onDestroyed)
        if (!value && !wc.isDestroyed()) {
          // Huỷ: gỡ listener + style còn treo trong trang. Best-effort — nếu
          // world đã mất thì không còn gì phải gỡ.
          void wc.executeJavaScript(PICK_CANCEL_SCRIPT, true).catch(() => undefined)
        }
        resolve(value)
      }
      wc.on('did-start-navigation', onNav)
      wc.once('destroyed', onDestroyed)
      this.pendingPick = record
      // Promise của trang: script trả về một Promise, Electron resolve theo nó.
      // Reject nghĩa là world bị phá giữa lúc chờ → coi như huỷ.
      wc.executeJavaScript(pickScript(PICK_TEXT_MAX, PICK_HTML_MAX), true).then(
        (result: unknown) => {
          if (!result) {
            settle(null)
            return
          }
          const o = asObject(result)
          settle({
            selector: clip(readString(o, 'selector'), 1_000),
            text: clip(readString(o, 'text'), PICK_TEXT_MAX),
            html: clip(readString(o, 'html'), PICK_HTML_MAX),
            url: wc.getURL(),
            title: wc.getTitle(),
          })
        },
        () => settle(null),
      )
    })
  }

  // `tabId` chỉ để lọc, không để tra: `this.tab()` TẠO tab mới khi chưa có tab
  // nào, và "huỷ" thì không được phép tạo ra thứ gì.
  cancelPick(tabId?: string): void {
    const pending = this.pendingPick
    if (!pending) return
    if (tabId && pending.tabId !== tabId) return
    pending.cancel()
  }

  async pageContext(tabId?: string): Promise<PageContext> {
    const tab = this.tab(tabId)
    const wc = tab.view.webContents
    // Cùng lý do với readSelection: chưa commit document thì lời gọi treo mãi.
    // `@page` trên một tab trắng phải trả rỗng để renderer nói "chưa mở trang nào",
    // chứ không phải chờ 15s rồi báo timeout.
    if (!hasCommittedPage(wc)) return { url: wc.getURL(), title: wc.getTitle(), text: '' }
    const raw = await this.run(tab, pageContextScript(PAGE_CONTEXT_MAX), 'page context')
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      text: clip(typeof raw === 'string' ? raw : '', PAGE_CONTEXT_MAX),
    }
  }

  // Chụp trang rồi ghi PNG vào `<root>/.awog/screenshots/<timestamp>.png`.
  //
  // `root` đến từ renderer nên là L1 (invariant #2): bắt buộc absolute (một
  // đường dẫn tương đối sẽ được `realpath` giải theo cwd của main — không phải
  // thứ người gọi nghĩ), canonicalize bằng `realpathSync` (ném luôn nếu root
  // không tồn tại, thay vì tự tạo cây thư mục ở một chỗ vô nghĩa), rồi kiểm tra
  // ĐÍCH GHI nằm trong root bằng đúng `resolveInsideWorkspace` mà mọi đường ghi
  // vào workspace khác dùng — nên một `.awog` là symlink trỏ ra ngoài cũng bị
  // chặn, không chỉ `..` trong chuỗi.
  //
  // Tên file do main sinh từ đồng hồ, không có mảnh input nào của người gọi,
  // nên không còn bề mặt traversal nào ở phần cuối đường dẫn.
  async saveScreenshot(root: string, tabId?: string): Promise<{ path: string }> {
    if (!root || !isAbsolute(root)) {
      throw new Error('saveScreenshot: workspace root must be an absolute path')
    }
    const tab = this.tab(tabId)
    // Kiểm đích ghi TRƯỚC khi chụp: một root sai thì không có lý gì tốn một lần
    // capture (và một lần primeSurface) rồi mới ném.
    const rootCanon = realpathSync(root)
    // Tạo rồi kiểm TỪNG CẤP. Để `mkdir -p` chạy hết đường rồi mới kiểm thì một
    // `.awog` là symlink trỏ ra ngoài vẫn kịp sinh một thư mục rỗng ở nơi không
    // được phép — không ghi byte nào, nhưng đã là tác dụng phụ ngoài phạm vi.
    let dir = rootCanon
    for (const segment of ['.awog', 'screenshots']) {
      await mkdir(join(dir, segment), { recursive: true })
      dir = resolveInsideWorkspace(rootCanon, join(dir, segment))
    }
    const img = await this.captureOrThrow(tab)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(dir, `${stamp}.png`)
    await writeFile(path, img.toPNG())
    log.info('browser screenshot saved', { tab: tab.id, path })
    return { path }
  }

  sites(): SitePolicy {
    return loadSites()
  }

  setSites(sites: unknown): void {
    saveSites(sites)
  }

  close(): void {
    // Picker đang chờ phải có đường ra trước khi tab bị phá — `destroyed` cũng
    // resolve nó, nhưng huỷ tường minh ở đây thì thứ tự không phụ thuộc event.
    this.cancelPick()
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    this.tabs.clear()
    this.activeId = null
    if (this.popoutWin && !this.popoutWin.isDestroyed()) this.popoutWin.destroy()
    this.popoutWin = null
    if (this.holder && !this.holder.isDestroyed()) this.holder.destroy()
    this.holder = null
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
      {
        selector: optionalString(p, 'selector'),
        ref: optionalString(p, 'ref'),
      },
      optionalString(p, 'tabId'),
    ),
  )
  engine.registerHostHandler('browser.fill', async (p) =>
    browser.fill(
      {
        selector: optionalString(p, 'selector'),
        ref: optionalString(p, 'ref'),
      },
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
  engine.registerHostHandler('browser.tabNew', async (p) =>
    browser.newTab(optionalString(p, 'url')),
  )
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
