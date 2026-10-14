import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app, BrowserWindow, WebContentsView, nativeImage, session } from 'electron'
import { captureDropTab, captureOnCdp, type CaptureHost } from './browser-capture'
import { fitEmulation } from './browser-emulation'
import { errorPageScript, renderErrorPage } from './browser-error-page'
import { clearDevServerPorts, evaluateHost, setDevServerPorts } from './browser-host-policy'
import { DEFAULT_PROFILE_ID, isValidProfileId, partitionForProfile } from './browser-profile'
import {
  buildSessionProxy,
  parseProxyConfig,
  parseProxyCredentials,
  parseTrace,
  proxyAuthMatches,
  type ProxyConfig,
  type ProxyCredentials,
} from './browser-proxy'
import { isHostAllowed, loadSites, saveSites } from './browser-sites'
import { engine } from './engine'
import { log } from './logger'
import { userscripts, type UserscriptTabState } from './browser-userscripts'
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
// One frame is enough to mint a compositor surface for a view that has never been
// shown; measured at 250ms with margin (see ensurePainted).
const PAINT_FRAME_MS = 250
// Thumbnail của thẻ trang trong transcript: rộng tối đa 640px, JPEG chất lượng 70.
const THUMB_WIDTH = 640
const THUMB_QUALITY = 70
// Clamp for a rect the RENDERER sends (L1 — see attach/setBounds).
const MAX_VIEW_EDGE = 10_000
// Cap cho ba đường đọc trang của phần E. Script tiêm vào trang đã tự cắt (đỡ
// băng thông IPC) nhưng main VẪN cắt lại: trang là L1, thứ nó TRẢ VỀ không phải
// thứ ta ép được nó trả về, nên cái cắt tính là cái ở đây.
const SELECTION_MAX = 20_000
const PICK_TEXT_MAX = 20_000
const PICK_HTML_MAX = 20_000
const PAGE_CONTEXT_MAX = 8_000

// Luật host nằm ở browser-host-policy.ts (thuần, có test). Allowlist site của
// người dùng (browser-sites.ts) áp SAU guard private/loopback trong đó.
//
// ĐÂY LÀ CHỖ DUY NHẤT luật host được thi hành: `navigate`, `openFromUser`,
// `setWindowOpenHandler`, `will-navigate`, `will-redirect`, `will-frame-navigate`
// đều gọi vào đúng hàm này, luôn kèm scope của TAB (không phải của caller) để
// ngoại lệ dev server theo phiên (docs/features/dev-server.md) không rò sang phiên khác và
// redirect/iframe của trang đi qua cùng luật với lần điều hướng đầu.
function hostBlocked(rawUrl: string, scope: string | undefined): string | null {
  return evaluateHost(rawUrl, scope, isHostAllowed)
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
  // Owning scope: a session's engineId for tabs that session's agent or user
  // opened, `task:…` for a workflow node, undefined for the global pool (popout /
  // tray). A scoped surface sees ONLY its own scope's tabs — "session nào mở
  // browser thì session đó hiện" — while unscoped callers resolve the global
  // active tab exactly as before.
  scope?: string
  // Profile (⇒ partition) của tab. Cố định suốt đời tab: đổi profile = tab mới.
  profileId: string
  // Window currently displaying the tab (embedded panel or popout), or null when
  // the tab is parked in the invisible holder.
  host: BrowserWindow | null
  // Favicon URL mà Chromium báo qua `page-favicon-updated` (thường là http(s)
  // của `<link rel=icon>`, đôi khi `data:` cho icon inline). '' = chưa biết/trang
  // không có icon — renderer fallback về glyph globe. Đây vẫn là string do TRANG
  // khai (L1): renderer chỉ được gán nó vào attribute `src` của <img>, không
  // innerHTML.
  favicon: string
  // Emulation mobile đang bật (toggle của người dùng trong chrome, hoặc preset
  // mobile/tablet của browser_tool qua `viewport`). Phản chiếu trong TabInfo để
  // menu hiện dấu tick.
  mobile: boolean
  // Thiết bị giả lập đang bật (null = không). Nguồn sự thật cho hình học:
  // `applyEmulation` suy bounds + scale từ đây và `slot`.
  emu: { width: number; height: number; dsf: number; mobile: boolean } | null
  // Key của override CDP đã gửi gần nhất — bỏ qua lời gửi trùng khi resize.
  emuKey: string
  // Rect renderer cấp cho tab này (đã clamp); null khi tab đỗ ở holder.
  slot: Rect | null
  // Đồng hồ tải trang cho chrome: mốc `did-start-loading` (epoch ms) và thời gian tới
  // `did-stop-loading` (spinner tắt — mọi frame xong). null = chưa có lượt tải nào xong.
  loadStartedAt: number | null
  loadMs: number | null
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
  // Favicon URL the page declares ('' when none/unknown). Rendered as <img src>
  // only — the string is L1 page data, never markup.
  favicon: string
  // Owning scope (session engineId / `task:…`); absent on the global pool. The
  // renderer filters a surface's tab list by it — "the browser of THIS session".
  scope?: string
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
  // Per-tab view state for the chrome menus: zoom factor (1 = 100%), DevTools
  // đang mở, và cờ emulation mobile (đặt bởi setMobileEmulation hoặc preset
  // mobile của browser_tool).
  zoom: number
  devtools: boolean
  mobile: boolean
  // Profile (partition) mà tab đang chạy.
  profileId: string
  // Profile của tab đi qua proxy riêng (chỉ cờ — host/credential không rời main).
  proxied: boolean
  // Đồng hồ tải trang: mốc bắt đầu (epoch ms, null = chưa tải) + tổng ms của lượt tải
  // gần nhất (null khi đang tải / chưa xong lượt nào). Renderer đếm sống từ mốc.
  loadStartedAt: number | null
  loadMs: number | null
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

// Đệm `img` (chụp từ view có `bounds`) thành ảnh phủ trọn `slot` bằng pixel trong
// suốt, view đặt đúng chỗ của nó trong slot. Dùng cho frame đông cứng khi view bị
// thu nhỏ giữa rect vì giả lập thiết bị. null nếu hình học không khớp (view không
// nằm trong slot / ảnh rỗng) — người gọi rơi về ảnh trần.
function padToSlot(img: Electron.NativeImage, bounds: Rect, slot: Rect): Electron.NativeImage | null {
  const { width: iw, height: ih } = img.getSize()
  if (iw < 1 || ih < 1 || bounds.width < 1 || slot.width < 1 || slot.height < 1) return null
  const f = iw / bounds.width
  const sw = Math.round(slot.width * f)
  const sh = Math.round(slot.height * f)
  const ox = Math.round((bounds.x - slot.x) * f)
  const oy = Math.round((bounds.y - slot.y) * f)
  if (ox < 0 || oy < 0 || ox + iw > sw || oy + ih > sh) return null
  const src = img.toBitmap()
  const out = Buffer.alloc(sw * sh * 4) // 0 = trong suốt
  for (let row = 0; row < ih; row++) {
    src.copy(out, ((oy + row) * sw + ox) * 4, row * iw * 4, (row + 1) * iw * 4)
  }
  return nativeImage.createFromBitmap(out, { width: sw, height: sh })
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

const VIEWPORT_PRESETS: Record<string, { width: number; height: number; scale: number; mobile: boolean; ua?: string }> =
  {
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
  // "Active" hai tầng: `activeId` là con trỏ GLOBAL — cho popout, tray và mọi
  // caller không mang scope (giữ nguyên hành vi cũ); `activeByScope` là con trỏ
  // RIÊNG của từng scope, vì "tab đang chọn của session A" không liên quan gì tới
  // tab session B đang nhìn. `activate()` là chỗ duy nhất đồng bộ cả hai.
  private activeId: string | null = null
  private activeByScope = new Map<string, string>()
  private tabSeq = 0
  // Invisible parent for every tab that is not on screen. See ensureHolder.
  private holder: BrowserWindow | null = null
  // Standalone window for the tray toggle / "pop out" (at most one).
  private popoutWin: BrowserWindow | null = null
  // Scope mà renderer của cửa sổ popout đang hiển thị (query `?scope=` lúc load
  // route). `null` = pool global. Phải nhớ ở đây vì cửa sổ là singleton: một cú
  // popout từ panel của session khác phải RE-POINT cửa sổ, còn cú toggle của
  // tray (không scope) thì không được phép đổi hướng cửa sổ đang mở.
  private popoutScope: string | null = null
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
  // Profile hiệu lực theo scope (sidecar đẩy xuống / main hỏi lười) + profile của
  // pool global (= profile mặc định). `securedProfiles`: partition đã cài handler.
  private scopeProfile = new Map<string, string>()
  private resolving = new Map<string, Promise<string>>()
  private globalProfile = DEFAULT_PROFILE_ID
  private securedProfiles = new Set<string>()
  // Proxy theo profile (sidecar đẩy xuống qua `browser.setProfileProxy`). `null` = đi
  // thẳng, thiếu key = chưa biết. Credential CHỈ ở RAM main, không ghi đĩa/log.
  private proxies = new Map<string, ProxyConfig | null>()
  private proxyCreds = new Map<string, ProxyCredentials>()
  // Đã đồng bộ proxy từ sidecar ít nhất một lần. Trước đó profile "chưa biết" bị chặn
  // (fail-closed) thay vì đi thẳng — không để một profile có proxy lọt ra mạng trực tiếp.
  private proxiesSynced = false
  private proxySyncing: Promise<void> | null = null
  // Chống vòng lặp 407: proxy từ chối credential sai sẽ bắn `login` lại liên tục.
  private proxyLoginAttempts = new Map<string, { count: number; since: number }>()
  private loginHooked = false
  private proxyApplying = new Map<string, Promise<void>>()

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
    tab.slot = null
    holder.contentView.addChildView(tab.view)
    // A view that was already on screen KEEPS its bounds: bounds unchanged
    // means no resize event, so the page does not re-layout on park — and a
    // later attachTo() back to the same rect costs zero reflow too. Only a
    // never-shown view (zero-ish bounds) gets the holder size, because a page
    // still needs a sane layout to run in the background (media queries, JS
    // resize observers) before its first attach.
    const b = tab.view.getBounds()
    if (b.width < 8 || b.height < 8) {
      const [w, h] = holder.getContentSize()
      tab.view.setBounds({ x: 0, y: 0, width: w, height: h })
    }
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

  // Cổng cho bộ bắt request của NGƯỜI DÙNG (browser-capture.ts, ipc.ts nối vào). Mọi lần
  // resolve tab đi qua `this.tab(tabId, scope)` — cùng cổng sở hữu với các thao tác khác.
  captureHost(): CaptureHost {
    return {
      target: (tabId, scope) => {
        const tab = this.tab(tabId, scope)
        return {
          id: tab.id,
          wc: tab.view.webContents,
          scope: tab.scope,
          profileId: tab.profileId,
          debuggerOk: tab.debuggerOk,
        }
      },
      blocked: (url, scope) => hostBlocked(url, scope),
      ready: (profileId) => this.proxyReady(profileId),
    }
  }

  private changed(): void {
    this.onChange?.()
  }

  // ── Tab lifecycle ────────────────────────────────────────────────────────

  private createTab(scope?: string): BrowserTab {
    if (this.tabs.size >= MAX_TABS) {
      throw new Error(`too many browser tabs open (max ${MAX_TABS}) — close one first`)
    }
    this.tabSeq += 1
    const id = `tab_${this.tabSeq}`
    const profileId = this.profileSync(scope)
    this.ensurePartition(profileId)
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: partitionForProfile(profileId),
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
      favicon: '',
      mobile: false,
      emu: null,
      loadStartedAt: null,
      loadMs: null,
      emuKey: '',
      slot: null,
      profileId,
      ...(scope !== undefined ? { scope } : {}),
    }
    const wc = view.webContents
    wc.on('destroyed', () => {
      this.tabs.delete(id)
      captureDropTab(id)
      this.dropActive(tab)
      this.changed()
    })
    // Anything that changes what the tab strip / URL bar shows. The point of the
    // panel is watching the AGENT browse, so a navigation it triggers has to reach
    // the renderer without the renderer polling for it.
    const notify = (): void => this.changed()
    wc.on('did-navigate', () => {
      // Document mới thì icon của trang CŨ không còn đúng: xoá rồi để
      // `page-favicon-updated` của trang mới điền lại (trang không khai icon thì
      // nó bắn một danh sách rỗng). Cú "globe" chớp giữa chừng bị che bởi
      // spinner `loading` trên tab chip, nên giá của việc xoá sớm gần như bằng 0.
      tab.favicon = ''
      notify()
    })
    wc.on('did-navigate-in-page', notify)
    // Đồng hồ tải trang: bắt đầu ở điều hướng KHUNG CHÍNH sang document mới, dừng ở
    // `did-stop-loading` ĐẦU TIÊN sau đó. KHÔNG dùng `did-start-loading`: nó bắn cả cho
    // iframe tải muộn (quảng cáo, widget…) ⇒ một cặp start/stop vài ms sau khi trang đã
    // xong ghi đè con số thật bằng ~0 — người dùng thấy đồng hồ nhảy về 0.0s.
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      tab.loadStartedAt = Date.now()
      tab.loadMs = null
      notify()
    })
    wc.on('did-start-loading', notify)
    wc.on('did-stop-loading', () => {
      if (tab.loadStartedAt !== null && tab.loadMs === null) {
        tab.loadMs = Date.now() - tab.loadStartedAt
      }
      notify()
    })
    wc.on('page-title-updated', notify)
    // Favicon là của chip tab trên chrome — renderer không tự hỏi được (icon nằm
    // trong webContents của trang), nên main phải bắn `changed` khi nó đổi.
    wc.on('page-favicon-updated', (_event, favicons) => {
      const list = Array.isArray(favicons) ? favicons : []
      const next = list.find((f) => typeof f === 'string' && f.length > 0) ?? ''
      if (next === tab.favicon) return
      tab.favicon = next
      notify()
    })
    // Tải hỏng ở khung chính ⇒ Electron để tab TRẮNG (không có trang lỗi của Chrome).
    // Bơm trang lỗi vào document `chrome-error://` hiện tại: URL giữ nguyên là URL hỏng,
    // lịch sử không thêm mục. -3 (ERR_ABORTED) là huỷ chủ động (guard điều hướng, người
    // dùng bấm đi trang khác) — không phải lỗi để báo.
    wc.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      const html = renderErrorPage({
        code,
        desc,
        url,
        lang: app.getLocale().toLowerCase().startsWith('vi') ? 'vi' : 'en',
        proxy: this.proxies.get(tab.profileId) ?? null,
      })
      wc.executeJavaScript(errorPageScript(html)).catch((err: unknown) => {
        log.warn('browser error page inject failed', {
          url,
          err: err instanceof Error ? err.message : String(err),
        })
      })
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
      const reason = hostBlocked(url, tab.scope)
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
      if (/^https?:\/\//i.test(url) && !hostBlocked(url, tab.scope)) {
        // Popup của một tab scoped phải giữ NGUYÊN scope của nó — không thì link
        // `target=_blank` trong session A sẽ rơi vào pool global và hiện lên
        // mọi session khác.
        void this.newTab(url, true, tab.scope).catch((err: unknown) => {
          log.warn('browser popup tab failed', {
            err: err instanceof Error ? err.message : String(err),
          })
        })
      } else if (url) {
        log.warn('browser popup blocked', {
          reason: hostBlocked(url, tab.scope) ?? 'non-web scheme',
        })
      }
      return { action: 'deny' }
    })
    // Quyền + tải file: handler của partition đã cài ở ensurePartition.
    // Báo cáo của userscript đi qua console — không để lọt vào ring mà agent đọc.
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      if (userscripts.isReport(message)) return
      this.pushConsole(tab, level, message, line, sourceId)
    })
    // DevTools (Inspect trên chrome) + phím zoom: mở/đóng từ cửa sổ DevTools
    // rời cũng phải cập nhật dấu tick trong menu ⇒ cần `changed`. Đóng DevTools
    // còn detach debugger nội bộ của ta (một webContents một phiên CDP) → gắn
    // lại để network recording của tab sống tiếp.
    wc.on('devtools-opened', notify)
    wc.on('devtools-closed', () => {
      notify()
      if (!tab.debuggerOk) this.attachDebugger(tab)
    })
    // Phím zoom kiểu trình duyệt — chỉ chạy khi người dùng ĐANG tương tác trang
    // này (before-input-event chỉ bắn trên webContents được focus, nên phím của
    // renderer host không bị nuốt). ⌘= ⌘- ⌘0, kèm '+' cho phím US cần Shift.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.meta || input.control) || input.alt) return
      const k = input.key
      if (k !== '=' && k !== '+' && k !== '-' && k !== '0') return
      event.preventDefault()
      this.applyZoom(tab, k === '0' ? 'reset' : k === '-' ? 'out' : 'in')
    })
    userscripts.attachTab(id, wc)
    this.attachDebugger(tab)
    this.tabs.set(id, tab)
    this.activate(tab)
    this.park(tab)
    this.changed()
    return tab
  }

  // "Active" hai tầng: `activeId` là con trỏ GLOBAL — cho popout, tray và mọi
  // caller không mang scope (giữ nguyên hành vi cũ); `activeByScope` là con trỏ
  // RIÊNG của từng scope, vì "tab đang chọn của session A" không liên quan gì
  // tới tab session B đang nhìn. `activate()` là chỗ duy nhất đồng bộ cả hai.
  private activate(tab: BrowserTab): void {
    this.activeId = tab.id
    if (tab.scope !== undefined) this.activeByScope.set(tab.scope, tab.id)
  }

  // Tab biến mất (đóng/renderer crash): dọn cả hai con trỏ active. Thay thế bằng
  // tab đầu tiên còn sống TRONG CÙNG scope — tuyệt đối không nhảy sang tab của
  // session khác. Xoá khóa scope hẳn khi scope đó hết tab để `activeByScope`
  // không rỉ dữ liệu mỗi phiên.
  private dropActive(tab: BrowserTab): void {
    if (this.activeId === tab.id) {
      this.activeId = this.tabs.keys().next().value ?? null
    }
    if (tab.scope !== undefined && this.activeByScope.get(tab.scope) === tab.id) {
      const next = [...this.tabs.values()].find((t) => t.scope === tab.scope)
      if (next) this.activeByScope.set(tab.scope, next.id)
      else this.activeByScope.delete(tab.scope)
    }
  }

  // Active tab của một scope (không create-on-demand — chỉ đọc).
  private scopedActiveTab(scope: string): BrowserTab | undefined {
    const id = this.activeByScope.get(scope)
    const tab = id ? this.tabs.get(id) : undefined
    return tab && !tab.view.webContents.isDestroyed() ? tab : undefined
  }

  // Resolve a tab. Không có id → active tab CỦA SCOPE ĐÓ (active global khi
  // caller không mang scope); active hỏng/thiếu thì rơi về một tab mới TRONG
  // scope nên `navigate` lúc pool trống vẫn chạy. Id tường minh thuộc scope
  // khác → cùng lỗi 'no such tab' với id không tồn tại: một session không bao
  // giờ được chạm, huống chi mutate, tab của session khác — và không được phép
  // THĂM DÒ sự tồn tại của tab đó qua thông điệp lỗi khác nhau.
  private tab(tabId?: string, scope?: string): BrowserTab {
    if (tabId) {
      const found = this.tabs.get(tabId)
      if (!found || found.view.webContents.isDestroyed() || (scope !== undefined && found.scope !== scope)) {
        throw new Error(`no such browser tab: ${tabId}`)
      }
      return found
    }
    const active =
      scope === undefined ? (this.activeId ? this.tabs.get(this.activeId) : undefined) : this.scopedActiveTab(scope)
    if (active && !active.view.webContents.isDestroyed()) return active
    return this.createTab(scope)
  }

  // ── Console capture ──────────────────────────────────────────────────────

  private pushConsole(tab: BrowserTab, level: number, message: string, line: number, sourceId: string): void {
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
    userscripts.onDebuggerAttached(tab.id)
    wc.debugger.on('detach', () => {
      tab.debuggerOk = false
    })
    wc.debugger.on('message', (_event, method: string, params: unknown) => {
      const obj = asObject(params)
      this.onCdpEvent(tab, method, obj)
      captureOnCdp(tab.id, method, obj)
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
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ])
  }

  private run(tab: BrowserTab, code: string, label: string, ms = ACTION_TIMEOUT_MS): Promise<unknown> {
    return this.withTimeout(tab.view.webContents.executeJavaScript(code, true), ms, label)
  }

  async navigate(url: string, tabId?: string, scope?: string): Promise<{ url: string; title: string; tabId: string }> {
    const reason = hostBlocked(url, scope)
    if (reason) throw new Error(`blocked URL — ${reason}`)
    const tab = this.tab(tabId, scope)
    await this.proxyReady(tab.profileId)
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
    scope?: string,
  ): Promise<{ found: boolean; tabId: string }> {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): Promise<{ found: boolean; tabId: string }> {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): Promise<{ content: string; tabId: string }> {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): Promise<{
    text: string
    nodes: number
    refs: number
    truncated: boolean
    url: string
    title: string
    tabId: string
  }> {
    const tab = this.tab(tabId, scope)
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
    // Đang giả lập thiết bị: `capturePage` chụp CÁI ĐANG HIỆN, tức view đã co vừa
    // khung (vd 138×300 cho iPhone trong panel thấp) — model không đọc nổi. CDP
    // render đúng metrics của thiết bị (1170×2532 @3x), nên đi đường đó trước.
    let img = tab.emu ? await this.captureViaCdp(tab) : null
    if (!img) img = await this.tryCapture(tab)
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

  async screenshot(
    tabId?: string,
    scope?: string,
  ): Promise<{
    base64: string
    width: number
    height: number
    tabId: string
  }> {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): { entries: ConsoleEntry[]; total: number; tabId: string } {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): {
    entries: NetworkEntry[]
    total: number
    available: boolean
    tabId: string
  } {
    const tab = this.tab(tabId, scope)
    const needle = filter ? filter.toLowerCase() : null
    const filtered = needle
      ? tab.network.filter((e) => e.url.toLowerCase().includes(needle) || e.resourceType.toLowerCase() === needle)
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
    scope?: string,
  ): Promise<{
    body: string
    base64: boolean
    entry: NetworkEntry | null
    tabId: string
  }> {
    const tab = this.tab(tabId, scope)
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
    scope?: string,
  ): Promise<{
    width: number
    height: number
    scale: number
    mobile: boolean
    emulated: boolean
    tabId: string
  }> {
    const tab = this.tab(tabId, scope)
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
        tab.emu = { width, height, dsf: scale, mobile }
        await this.applyEmulation(tab)
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: mobile,
        })
        await dbg.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: preset?.ua ?? tab.view.webContents.getUserAgent(),
        })
        emulated = true
        // Giữ cờ TabInfo.mobile khớp với emulation thật: preset desktop/wide của
        // agent (mobile:false) cũng là một lần "tắt mobile" với chrome của người
        // dùng.
        tab.mobile = mobile
        this.changed()
      } catch (err) {
        log.warn('browser viewport emulation failed', {
          tab: tab.id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { width, height, scale, mobile, emulated, tabId: tab.id }
  }

  // ── Profiles ─────────────────────────────────────────────────────────────

  // Cài handler an toàn cho partition của một profile — ĐÚNG MỘT lần mỗi partition.
  // Trang web ở đây là L1 tuyệt đối: không có handler thì Electron DUYỆT MẶC ĐỊNH
  // mọi yêu cầu quyền, nên một trang xin clipboard (thường chứa mật khẩu/API key),
  // vị trí, hay notification đều được cấp im lặng. Từ chối tất cả; cần quyền nào
  // sau này thì allowlist đúng cái đó. Trang cũng không được tự tải file về máy.
  private ensurePartition(profileId: string): void {
    if (this.securedProfiles.has(profileId)) return
    const ses = session.fromPartition(partitionForProfile(profileId))
    ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (event) => {
      log.warn('browser download blocked')
      event.preventDefault()
    })
    this.securedProfiles.add(profileId)
    this.hookProxyLogin()
    void this.applyProxy(profileId)
  }

  // ── Proxy theo profile ───────────────────────────────────────────────────

  // Áp trạng thái proxy đã biết của profile vào partition rồi cắt kết nối đang giữ để
  // tab chuyển tuyến ngay. Chưa đồng bộ lần nào + chưa biết ⇒ chặn (cổng 1 trên
  // loopback từ chối kết nối) cho tới khi sidecar báo.
  private applyProxy(profileId: string): Promise<void> {
    const run = this.applyProxyNow(profileId)
    this.proxyApplying.set(profileId, run)
    return run
  }

  // Chờ partition mang đúng tuyến TRƯỚC lượt tải đầu: `ensurePartition` áp proxy không
  // chờ (nó chạy đồng bộ trong `createTab`), nên `loadURL` ngay sau đó có thể đi trước
  // `setProxy` — với profile có proxy là lộ IP thật đúng ở trang đầu tiên. Chưa đồng bộ
  // lần nào thì kéo trạng thái về trước, để trang đầu lúc khởi động không đâm vào cổng
  // chặn tạm (fail-closed) trong khi sidecar đã sẵn sàng trả lời.
  private async proxyReady(profileId: string): Promise<void> {
    if (!this.proxiesSynced) await this.syncProxies()
    await this.proxyApplying.get(profileId)
  }

  private async applyProxyNow(profileId: string): Promise<void> {
    const ses = session.fromPartition(partitionForProfile(profileId))
    const cfg = this.proxies.get(profileId)
    try {
      if (cfg) await ses.setProxy(buildSessionProxy(cfg))
      else if (cfg === undefined && !this.proxiesSynced) {
        await ses.setProxy({
          mode: 'fixed_servers',
          proxyRules: 'http://127.0.0.1:1',
        })
      } else await ses.setProxy({ mode: 'direct' })
      await ses.closeAllConnections()
    } catch (err) {
      log.warn('browser proxy apply failed', {
        profile: profileId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Sidecar đẩy proxy (+ credential) của một profile. Không đổi gì ⇒ bỏ qua để các
  // lần đồng bộ lặp lại không cắt kết nối vô cớ.
  async setProfileProxy(
    profileId: string,
    proxy: ProxyConfig | null,
    auth: ProxyCredentials | undefined,
  ): Promise<void> {
    partitionForProfile(profileId)
    const prevCfg = this.proxies.get(profileId)
    const prevAuth = this.proxyCreds.get(profileId)
    const same =
      prevCfg !== undefined &&
      JSON.stringify(prevCfg) === JSON.stringify(proxy) &&
      prevAuth?.username === auth?.username &&
      prevAuth?.password === auth?.password
    if (same) return
    this.proxies.set(profileId, proxy)
    if (proxy && auth) this.proxyCreds.set(profileId, auth)
    else this.proxyCreds.delete(profileId)
    this.proxyLoginAttempts.delete(profileId)
    if (this.securedProfiles.has(profileId)) await this.applyProxy(profileId)
    this.changed()
  }

  // Hỏi sidecar đẩy lại proxy của mọi profile (khởi động / engine restart / danh sách
  // đổi). Một chuyến bay một lúc.
  syncProxies(): Promise<void> {
    if (this.proxySyncing) return this.proxySyncing
    this.proxySyncing = (async () => {
      try {
        await engine.request('browserProfiles.syncProxies', null)
        this.proxiesSynced = true
        // Partition đã mở mà sidecar không nhắc tới ⇒ đi thẳng (hết trạng thái chặn).
        for (const id of this.securedProfiles) {
          if (!this.proxies.has(id)) {
            this.proxies.set(id, null)
            await this.applyProxy(id)
          }
        }
      } catch (err) {
        log.warn('browser proxy sync failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      } finally {
        this.proxySyncing = null
      }
    })()
    return this.proxySyncing
  }

  isProxied(profileId: string): boolean {
    return this.proxies.get(profileId) != null
  }

  // Trả lời 407 của proxy bằng credential đã lưu — chỉ khi (a) là thử thách proxy,
  // (b) webContents thuộc đúng partition của profile có proxy ấy, (c) host:port khớp
  // cấu hình. Mọi ca khác bỏ qua ⇒ hành vi mặc định (huỷ), không lộ credential.
  private hookProxyLogin(): void {
    if (this.loginHooked) return
    this.loginHooked = true
    app.on('login', (event, wc, _details, authInfo, callback) => {
      if (!authInfo.isProxy || !wc) return
      for (const [id, cfg] of this.proxies) {
        if (!cfg) continue
        if (wc.session !== session.fromPartition(partitionForProfile(id))) continue
        const creds = this.proxyCreds.get(id)
        if (!creds || !proxyAuthMatches(authInfo, cfg)) return
        const now = Date.now()
        const prev = this.proxyLoginAttempts.get(id)
        const att = prev && now - prev.since < 30_000 ? prev : { count: 0, since: now }
        att.count++
        this.proxyLoginAttempts.set(id, att)
        if (att.count > 3) {
          log.warn('browser proxy auth rejected repeatedly — giving up', {
            profile: id,
          })
          return
        }
        event.preventDefault()
        callback(creds.username, creds.password)
        return
      }
    })
  }

  // Thử tuyến của một profile: người dùng bấm "Test" ⇒ MỘT request qua đúng partition
  // đó (không gọi thêm đường trực tiếp để so sánh).
  async testProxy(profileId: string): Promise<{ ok: boolean; ip?: string; loc?: string; error?: string }> {
    this.ensurePartition(profileId)
    if (!this.proxiesSynced) await this.syncProxies()
    await this.proxyApplying.get(profileId)
    const ses = session.fromPartition(partitionForProfile(profileId))
    try {
      const res = await ses.fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const { ip, loc } = parseTrace(await res.text())
      if (!ip) return { ok: false, error: 'Unexpected response (no ip)' }
      return { ok: true, ip, ...(loc ? { loc } : {}) }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Profile của scope, đọc ĐỒNG BỘ từ cache (createTab không async được). Chưa
  // biết ⇒ tạm dùng mặc định và hỏi sidecar ngầm; kết quả về sẽ đi qua
  // setScopeProfile nên tab đã lỡ tạo ở partition tạm được chuyển sang đúng chỗ.
  private profileSync(scope?: string): string {
    if (scope === undefined) return this.globalProfile
    const cached = this.scopeProfile.get(scope)
    if (cached) return cached
    void this.profileOf(scope)
    return DEFAULT_PROFILE_ID
  }

  // Profile hiệu lực của scope; hỏi sidecar (`browserProfiles.resolveScope`) khi
  // chưa có cache. Lỗi sidecar ⇒ mặc định, KHÔNG cache để lần sau hỏi lại.
  async profileOf(scope?: string): Promise<string> {
    if (scope === undefined) return this.globalProfile
    const cached = this.scopeProfile.get(scope)
    if (cached) return cached
    let pending = this.resolving.get(scope)
    if (!pending) {
      pending = (async () => {
        try {
          const res = asObject(await engine.request('browserProfiles.resolveScope', { scope }))
          const id = readString(res, 'profileId')
          if (!isValidProfileId(id)) throw new Error(`sidecar returned invalid profile id: ${id}`)
          // Sidecar có thể đã đẩy giá trị mới hơn trong lúc ta chờ: không đè.
          if (!this.scopeProfile.has(scope)) await this.setScopeProfile(scope, id)
          return this.scopeProfile.get(scope) ?? id
        } catch (err) {
          log.warn('browser profile resolve failed', {
            scope,
            err: err instanceof Error ? err.message : String(err),
          })
          return DEFAULT_PROFILE_ID
        } finally {
          this.resolving.delete(scope)
        }
      })()
      this.resolving.set(scope, pending)
    }
    return pending
  }

  // Đổi profile hiệu lực của một scope. Có tab ở partition cũ ⇒ đóng + mở lại cùng
  // URL ở partition mới (cùng thứ tự, cùng tab active, cùng rect nếu đang nhúng).
  async setScopeProfile(scope: string, profileId: string): Promise<void> {
    partitionForProfile(profileId)
    this.scopeProfile.set(scope, profileId)
    await this.reopenTabs(scope, profileId)
  }

  // Profile mặc định (cho pool global) do sidecar giữ; đọc lại khi nó có thể đã đổi.
  async refreshGlobalProfile(): Promise<void> {
    try {
      const res = asObject(await engine.request('browserProfiles.list', null))
      const id = readString(res, 'defaultProfileId')
      if (!isValidProfileId(id) || id === this.globalProfile) return
      this.globalProfile = id
      await this.reopenTabs(undefined, id)
    } catch (err) {
      log.warn('browser default profile refresh failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async reopenTabs(scope: string | undefined, profileId: string): Promise<void> {
    const stale = [...this.tabs.values()].filter(
      (t) => t.scope === scope && t.profileId !== profileId && !t.view.webContents.isDestroyed(),
    )
    if (stale.length === 0) return
    const activeId = scope === undefined ? this.activeId : (this.activeByScope.get(scope) ?? null)
    const plan = stale.map((t) => ({
      url: t.view.webContents.getURL(),
      wasActive: t.id === activeId,
      host: t.host && !t.host.isDestroyed() ? t.host : null,
      slot: t.slot,
    }))
    this.cancelPick()
    for (const t of stale) this.discardTab(t)
    let reopenedActive: BrowserTab | null = null
    let last: BrowserTab | null = null
    for (const p of plan) {
      const tab = this.createTab(scope)
      last = tab
      if (p.wasActive) reopenedActive = tab
      if (p.url && p.url !== 'about:blank' && !hostBlocked(p.url, scope)) {
        const target = p.url
        void this.proxyReady(tab.profileId)
          .then(() => tab.view.webContents.loadURL(target))
          .catch((err: unknown) => {
            log.warn('browser reopen load failed', {
              url: p.url,
              err: err instanceof Error ? err.message : String(err),
            })
          })
      }
      if (p.wasActive && p.host && p.slot) this.attachTo(p.host, tab.id, p.slot, scope)
    }
    const target = reopenedActive ?? last
    if (target) this.activate(target)
    this.changed()
    log.info('browser tabs moved to profile', {
      scope: scope ?? '(global)',
      profileId,
      tabs: plan.length,
    })
  }

  // Gỡ tab khỏi sổ NGAY rồi đóng: `destroyed` bắn bất đồng bộ mà MAX_TABS đếm
  // trên sổ này.
  private discardTab(tab: BrowserTab): void {
    this.tabs.delete(tab.id)
    this.dropActive(tab)
    if (tab.host && !tab.host.isDestroyed()) tab.host.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
  }

  // Profile bị xoá: đóng mọi tab còn ở partition đó (sidecar thường đã đẩy
  // setScopeProfile trước nên tab đã chuyển đi), rồi xoá sạch dữ liệu của nó.
  async wipeProfile(profileId: string): Promise<void> {
    const ses = session.fromPartition(partitionForProfile(profileId))
    for (const t of [...this.tabs.values()]) {
      if (t.profileId === profileId) this.discardTab(t)
    }
    for (const [scope, id] of this.scopeProfile) {
      if (id === profileId) this.scopeProfile.delete(scope)
    }
    if (this.globalProfile === profileId) {
      // Xoá dữ liệu (không xoá profile) thì mặc định vẫn là nó: đọc lại từ sidecar.
      this.globalProfile = DEFAULT_PROFILE_ID
      void this.refreshGlobalProfile()
    }
    await ses.clearStorageData()
    await ses.clearCache()
    this.changed()
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
      favicon: tab.favicon,
      scope: tab.scope,
      profileId: tab.profileId,
      proxied: this.isProxied(tab.profileId),
      active: tab.id === this.activeId,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      shown: forWindow ? host === forWindow : host !== null,
      shownElsewhere: forWindow ? host !== null && host !== forWindow : false,
      zoom: wc.getZoomFactor(),
      devtools: wc.isDevToolsOpened(),
      mobile: tab.mobile,
      loadStartedAt: tab.loadStartedAt,
      loadMs: tab.loadMs,
    }
  }

  // Menu ⋮ của chrome: userscript đã chạy / khớp trang hiện tại của tab. Cùng cổng
  // `this.tab()` ⇒ một surface không hỏi được tab của scope khác.
  userscriptsForTab(tabId?: string, scope?: string): UserscriptTabState {
    const tab = this.tab(tabId, scope)
    return userscripts.forTab(tab.id, tab.view.webContents.getURL())
  }

  // `scope` lọc danh sách VÀ đổi nghĩa của `active`/`activeTabId`: với scope
  // thì "active" là con trỏ RIÊNG của scope đó — một mặt session không bao giờ
  // nhìn thấy tab của session khác, kể cả chỉ qua cờ `active` trên danh sách.
  // `activeByScope` snapshot để renderer phân rã cho nhiều scope cùng lúc (panel
  // KeepAlive của session đang ngủ vẫn biết nó trông thế nào).
  listTabs(
    forWindow?: BrowserWindow,
    scope?: string,
  ): {
    tabs: TabInfo[]
    activeTabId: string | null
    activeByScope: Record<string, string>
  } {
    const scopedActive = scope === undefined ? this.activeId : (this.activeByScope.get(scope) ?? null)
    const tabs: TabInfo[] = []
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents.isDestroyed()) continue
      if (scope !== undefined && tab.scope !== scope) continue
      const info = this.info(tab, forWindow)
      if (scope !== undefined) info.active = tab.id === scopedActive
      tabs.push(info)
    }
    return {
      tabs,
      activeTabId: scopedActive,
      activeByScope: Object.fromEntries(this.activeByScope),
    }
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
    scope?: string,
  ): Promise<{ tabId: string; url: string; title: string }> {
    const tab = this.createTab(scope)
    if (!url) return { tabId: tab.id, url: '', title: '' }
    if (!waitForLoad) {
      // Guard host chạy TRƯỚC và đồng bộ, nên URL bị chặn vẫn ném ngay cho người
      // gọi — chỉ phần tải là không chờ.
      const reason = hostBlocked(url, scope)
      if (reason) throw new Error(`cannot open ${url}: ${reason}`)
      void this.navigate(url, tab.id, scope).catch((err: unknown) => {
        log.warn('browser background navigation failed', {
          tab: tab.id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
      return { tabId: tab.id, url, title: '' }
    }
    const res = await this.navigate(url, tab.id, scope)
    return { tabId: tab.id, url: res.url, title: res.title }
  }

  // Make a tab the active one. "Active" is PER-SCOPE: the tab a scoped tool
  // call with no `tabId` lands on; it is NOT a visibility change any more — a
  // window that is showing some other tab keeps showing it until its renderer
  // asks to attach this one (attachTo). That split is what lets the agent
  // switch tabs mid-turn without yanking the view out from under whoever is
  // watching — and what lets two sessions each keep their own "current tab".
  selectTab(tabId: string, scope?: string): TabInfo {
    const tab = this.tab(tabId, scope)
    this.activate(tab)
    this.changed()
    return this.info(tab)
  }

  closeTab(tabId: string, scope?: string): { closed: string; remaining: number } {
    const tab = this.tab(tabId, scope)
    if (tab.host && !tab.host.isDestroyed()) tab.host.contentView.removeChildView(tab.view)
    // `destroyed` on the webContents does the bookkeeping (see createTab).
    tab.view.webContents.close()
    this.tabs.delete(tab.id)
    this.dropActive(tab)
    this.changed()
    return { closed: tab.id, remaining: this.tabs.size }
  }

  // ── Embedding (the session workspace panel) ──────────────────────────────
  //
  // The renderer owns the rect and asks main to put a tab in it. Main resolves the
  // host window from the IPC sender, never from a payload — a renderer can only
  // ever fill its OWN window (security invariant #4). The rect is L1: clamped here.

  attachTo(host: BrowserWindow, tabId: string | undefined, rect: Rect, scope?: string): TabInfo {
    // `tabId` từ renderer là một BẢN CACHE, và cache thì cũ được: renderer giữ
    // danh sách tab từ event `changed` cuối cùng nó nhận, nên nó hoàn toàn có thể
    // xin `tab_1` sau khi tab đó đã bị đóng (lỗi thật 2026-09-09:
    // `Error invoking remote method 'browser:attach': no such browser tab: tab_1`).
    //
    // `this.tab(id)` NÉM cho một id không còn — đúng cho mọi hành động chỉ định
    // tab (đọc/điều hướng tab nào là ý muốn rõ ràng), nhưng SAI cho `attach`:
    // đây là một yêu cầu HÌNH HỌC ("cho tôi một view vào hình chữ nhật này"), và
    // main là nguồn sự thật. Nên id lạ — hoặc id của MỘT SCOPE KHÁC (panel cũ
    // của một session KeepAlive vẫn có thể giữ cache cũ) — thì rơi về tab active
    // CỦA SCOPE đó (tạo mới trong scope nếu chưa có) và TabInfo trả về mang id
    // thật để renderer tự sửa mình theo.
    const known = tabId ? this.tabs.get(tabId) : undefined
    const tab =
      known && !known.view.webContents.isDestroyed() && (scope === undefined || known.scope === scope)
        ? known
        : this.tab(undefined, scope)
    // One webContents cannot be in two rects, so attaching hands the tab over:
    // any other window showing it loses it. Other tabs in THIS window are only
    // parked when their rect overlaps the target rect — i.e. they occupied the
    // SAME surface (a tab switch inside one panel). A window can host several
    // surfaces at different rects (main tab pane + dock + future ones), each
    // showing its own tab's view; a surface must not evict another surface's
    // view just because it attached. Whoever lost a tab sees `shown: false` on
    // the next change event and renders the "showing elsewhere" placeholder.
    const target = clampRect(rect)
    for (const other of this.tabs.values()) {
      if (other.id === tab.id || other.host !== host) continue
      const ob = other.view.getBounds()
      const ox = Math.min(ob.x + ob.width, target.x + target.width) - Math.max(ob.x, target.x)
      const oy = Math.min(ob.y + ob.height, target.y + target.height) - Math.max(ob.y, target.y)
      // Chỉ giấu tab chiếm GẦN NHƯ TRỌN rect đích — tức chuyển tab trong CÙNG
      // một bề mặt. View ở lại trong window với bounds y nguyên: lượt bấm quay
      // lại chỉ là setVisible — không reparent, không reflow, không nháy trắng.
      // Chồng lấn MỘT PHẦN (PiP đè góc viewport) thì để cả hai vẽ — view thêm
      // sau nằm trên trong vùng chồng, đúng ý nghĩa "thẻ nổi".
      if (ox > 0 && oy > 0 && (ox * oy) / (ob.width * ob.height || 1) >= 0.9) {
        other.view.setVisible(false)
      }
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
    tab.slot = target
    this.layoutTab(tab)
    // View có thể đang bị giấu tại chỗ (concealAt / overlap ở trên) — bật lại
    // SAU setBounds để frame đầu đã ở đúng rect.
    tab.view.setVisible(true)
    tab.painted = true
    this.activate(tab)
    this.changed()
    return this.info(tab, host)
  }

  // Follow the panel's layout: scroll, resize, dock change. Bounds-only, so it is
  // cheap enough to call from a ResizeObserver. `scope` khoá resolve về active
  // của scope đó — một payload cũ của panel ngủ không được dời rect của tab
  // session khác.
  setViewBounds(host: BrowserWindow, tabId: string | undefined, rect: Rect, scope?: string): void {
    const tab = tabId ? this.tabs.get(tabId) : scope !== undefined ? this.scopedActiveTab(scope) : this.activeTab()
    if (!tab || tab.view.webContents.isDestroyed() || tab.host !== host) return
    if (scope !== undefined && tab.scope !== scope) return
    tab.slot = clampRect(rect)
    this.layoutTab(tab)
  }

  // Hide (NOT unpaint) every tab occupying `rect` of this window: the view
  // stays a child of the window with its bounds intact, so showing it again is
  // a setBounds-with-same-bounds + setVisible — no reparent, no compositor
  // surface rebuild, no page reflow. This is how a surface "detaches" in the
  // multi-surface model.
  //
  // `rect` scopes the hide to ONE surface: a window hosts several (main pane,
  // dock, PiP card) and only the caller's own rect may be hidden — hiding all
  // tabs in the window would yank a sibling surface's view (e.g. the PiP card
  // holding a tab this surface just released).
  concealAt(host: BrowserWindow, rect: Rect): void {
    const target = clampRect(rect)
    let hid = false
    for (const tab of this.tabs.values()) {
      if (tab.host !== host) continue
      const b = tab.view.getBounds()
      const ox = Math.min(b.x + b.width, target.x + target.width) - Math.max(b.x, target.x)
      const oy = Math.min(b.y + b.height, target.y + target.height) - Math.max(b.y, target.y)
      // ≥90% của bounds VIEW nằm trong rect đích — cùng ngưỡng với vòng conceal
      // của attachTo. Bề mặt chỉ được giấu view chiếm GẦN TRỌN rect của nó (tab
      // nó đang giữ); chồng lấn MỘT PHẦN (PiP đè góc viewport) thuộc bề mặt khác
      // — giấu nó khiến instance kia reclaim ngay → view tắt-bật = nháy.
      if (ox > 0 && oy > 0 && (ox * oy) / (b.width * b.height || 1) >= 0.9) {
        tab.view.setVisible(false)
        hid = true
      }
    }
    if (hid) this.changed()
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

  // Đặt bounds của view theo rect renderer cấp (`tab.slot`) và — nếu tab đang giả
  // lập thiết bị — co thiết bị vừa rect rồi đẩy override CDP kèm `scale`. Phần
  // đồng bộ (setBounds) chạy ngay trong lời gọi nên ResizeObserver của renderer
  // không phải đợi CDP; override tới sau một nhịp, trùng key thì bỏ qua.
  // Không giả lập: view = rect như cũ. Tab đang đỗ ở holder (không có slot): scale 1.
  private async applyEmulation(tab: BrowserTab): Promise<void> {
    const emu = tab.emu
    const slot = tab.host && !tab.host.isDestroyed() ? tab.slot : null
    if (!emu) {
      if (slot) tab.view.setBounds(slot)
      return
    }
    let scale = 1
    if (slot) {
      const fit = fitEmulation(slot, emu.width, emu.height)
      tab.view.setBounds(fit.bounds)
      scale = fit.scale
    }
    const key = `${emu.width}x${emu.height}@${emu.dsf}/${emu.mobile}/${scale}`
    if (key === tab.emuKey || !tab.debuggerOk) return
    tab.emuKey = key
    try {
      await tab.view.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: emu.width,
        height: emu.height,
        deviceScaleFactor: emu.dsf,
        mobile: emu.mobile,
        scale,
        screenWidth: emu.width,
        screenHeight: emu.height,
        // KHÔNG để Chromium đổi visible size của renderer thành cỡ thiết bị: đó
        // chính là thứ làm trang vẽ lố khỏi bounds view (browser-emulation.ts).
        dontSetVisibleSize: true,
      })
    } catch (err) {
      tab.emuKey = ''
      throw err
    }
  }

  // Gọi từ đường renderer-driven (attach/resize) — không ai await, nên lỗi chỉ log.
  private layoutTab(tab: BrowserTab): void {
    this.applyEmulation(tab).catch((err: unknown) => {
      log.warn('browser emulation layout failed', {
        tab: tab.id,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // ── User-driven navigation (URL bar, back/forward/reload) ────────────────
  //
  // Same guard as the agent's `navigate`: a URL typed in the panel is still L1
  // (it can be pasted from model output). `hostBlocked` keeps the loopback/private
  // rule identical for both callers — this is not a back door around invariant #7.

  async openFromUser(url: string, tabId?: string, scope?: string): Promise<TabInfo> {
    const target = normalizeUserUrl(url)
    const reason = hostBlocked(target, scope)
    if (reason) throw new Error(`cannot open ${target}: ${reason}`)
    const tab = this.tab(tabId, scope)
    await this.proxyReady(tab.profileId)
    await this.withTimeout(tab.view.webContents.loadURL(target), NAV_TIMEOUT_MS, 'navigation').catch((err: unknown) => {
      // A failed load leaves the tab usable (error page); report it as data.
      log.warn('browser user navigation failed', {
        url: target,
        err: err instanceof Error ? err.message : String(err),
      })
    })
    this.changed()
    return this.selectTab(tab.id, scope)
  }

  goBack(tabId?: string, scope?: string): void {
    const wc = this.tab(tabId, scope).view.webContents
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(tabId?: string, scope?: string): void {
    const wc = this.tab(tabId, scope).view.webContents
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(tabId?: string, scope?: string): void {
    this.tab(tabId, scope).view.webContents.reload()
  }

  // ── Zoom / DevTools / mobile emulation (chrome ⋯ menu) ─────────────────────

  // Zoom level (không phải factor): các bậc của Chromium, 0 = 100%. Nằm trên
  // webContents nên sống theo tab qua mọi lần điều hướng.
  private applyZoom(tab: BrowserTab, action: 'in' | 'out' | 'reset'): void {
    const wc = tab.view.webContents
    const cur = wc.getZoomLevel()
    const next = action === 'reset' ? 0 : Math.max(-8, Math.min(9, cur + (action === 'in' ? 1 : -1)))
    if (next === cur) return
    wc.setZoomLevel(next)
    this.changed()
  }

  zoom(tabId: string | undefined, scope: string | undefined, action: 'in' | 'out' | 'reset'): void {
    this.applyZoom(this.tab(tabId, scope), action)
  }

  // DevTools rời — `open` vắng = toggle. Mở DevTools detach phiên CDP nội bộ
  // (một webContents một session inspector) → nhả chủ động trước khi mở, và
  // `devtools-closed` ở createTab gắn lại để network recording không chết dần
  // sau mỗi lần Inspect.
  devTools(tabId: string | undefined, scope: string | undefined, open?: boolean): void {
    const tab = this.tab(tabId, scope)
    const wc = tab.view.webContents
    const want = open ?? !wc.isDevToolsOpened()
    if (want === wc.isDevToolsOpened()) return
    if (want) {
      if (tab.debuggerOk) wc.debugger.detach()
      wc.openDevTools({ mode: 'detach' })
    } else {
      wc.closeDevTools()
    }
    this.changed()
  }

  // Chế độ mobile kiểu DevTools device-mode: CDP emulation (metrics + touch +
  // UA iPhone) tái dùng đúng preset của browser_tool.viewport. Bật lại sau khi
  // đã bật là no-op; tắt = clear override + trả UA gốc.
  async setMobileEmulation(
    tabId: string | undefined,
    scope: string | undefined,
    on: boolean,
  ): Promise<{ mobile: boolean }> {
    const tab = this.tab(tabId, scope)
    const wc = tab.view.webContents
    if (on === tab.mobile || !tab.debuggerOk) {
      if (!tab.debuggerOk) log.warn('mobile emulation skipped — debugger not attached', { tab: tab.id })
      return { mobile: tab.mobile }
    }
    const dbg = wc.debugger
    try {
      if (on) {
        const p = VIEWPORT_PRESETS.mobile
        tab.emu = {
          width: p.width,
          height: p.height,
          dsf: p.scale,
          mobile: true,
        }
        // Bounds (co vừa khung, căn giữa) + override + scale đi cùng một chỗ — xem
        // browser-emulation.ts vì sao không được gửi override trần.
        await this.applyEmulation(tab)
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: true,
        })
        await dbg.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: p.ua ?? '',
        })
      } else {
        tab.emu = null
        tab.emuKey = ''
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: false,
        })
        // '' = bỏ override, trở về UA thật của session.
        await dbg.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: '',
        })
        // Trả view về full rect của renderer.
        await this.applyEmulation(tab)
      }
      tab.mobile = on
    } catch (err) {
      log.warn('browser mobile emulation failed', {
        tab: tab.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    this.changed()
    return { mobile: tab.mobile }
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

  show(scope?: string): void {
    // Vẫn đảm bảo có ít nhất một tab TRONG SCOPE của caller: popout từ panel của
    // một session chưa có tab thì phải tạo tab THUỘC session đó (không thì cửa
    // sổ scope=A mở lên nhìn thấy tab global — hoặc trống rỗng). Tray không mang
    // scope ⇒ pool global như cũ. Không attach ở đây — đó là việc của renderer.
    this.tab(undefined, scope)
    const win = this.ensurePopout(scope)
    win.show()
    win.focus()
  }

  hide(): void {
    if (this.popoutWin && !this.popoutWin.isDestroyed()) this.popoutWin.hide()
  }

  isVisible(): boolean {
    return !!this.popoutWin && !this.popoutWin.isDestroyed() && this.popoutWin.isVisible()
  }

  private ensurePopout(scope?: string): BrowserWindow {
    const existing = this.popoutWin
    if (existing && !existing.isDestroyed()) {
      // Re-scope CHỈ khi caller nêu scope tường minh và nó khác scope đang hiển
      // thị — nạp lại route với query mới để renderer re-scope. Cú `show()`
      // trần của tray không vào nhánh này: tray bật/tắt cửa sổ, không đổi chủ
      // của nó (đổi = giật tầm nhìn của người đang popout từ một session).
      if (scope !== undefined && scope !== this.popoutScope) {
        this.popoutScope = scope
        // Park view của scope cũ TRƯỚC khi nạp lại — nếu không nó vẫn là child
        // của cửa sổ này và đè lên trang mới cho tới khi renderer mới kịp attach.
        this.detachFrom(existing)
        loadAppRoute(existing, `browser?scope=${encodeURIComponent(scope)}`)
      }
      return existing
    }
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
        // Cửa sổ này host chrome của app (thanh địa chỉ…) — spellcheck macOS chỉ
        // thêm log NSSpellServer timeout; tab web bên trong là WebContentsView
        // riêng, spellcheck của trang web vẫn giữ nguyên.
        spellcheck: false,
      },
    })
    applyNavigationGuards(win)
    // `close` chứ không `closed`: view con bị phá cùng cửa sổ cha, nên phải park
    // tab TRƯỚC khi cửa sổ biến mất — không thì đóng popout là mất trang.
    win.on('close', () => this.detachFrom(win))
    win.on('closed', () => {
      this.popoutWin = null
      this.popoutScope = null
      this.changed()
    })
    this.popoutWin = win
    this.popoutScope = scope ?? null
    loadAppRoute(win, this.popoutScope ? `browser?scope=${encodeURIComponent(this.popoutScope)}` : 'browser')
    return win
  }

  // ── Read + point (ADR 0086 phần E) ───────────────────────────────────────
  //
  // Ba đường đọc trang này trả NỘI DUNG TRANG về cho renderer, thứ phần còn lại
  // của feature cố ý không làm (mọi thứ MODEL đọc đi qua browser_tool phía
  // sidecar, nơi có nonce fence + redactor). Khác nhau ở chỗ AI hỏi: mỗi lời gọi
  // ở đây bắt đầu từ một cú bấm của người dùng trong chrome của trình duyệt, và
  // text hạ cánh trong UI của chính họ — không tự chảy vào prompt.

  async readSelection(tabId?: string, scope?: string): Promise<PageSelection> {
    const tab = this.tab(tabId, scope)
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
    const raw = await this.run(tab, selectionScript(SELECTION_MAX), 'read selection', SELECTION_TIMEOUT_MS)
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
  async pickElement(tabId?: string, scope?: string): Promise<PickedElement | null> {
    const tab = this.tab(tabId, scope)
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
  // nào, và "huỷ" thì không được phép tạo ra thứ gì. `scope` cũng chỉ lọc: một
  // cancel của scope khác không được đụng vào picker đang arm trên tab không
  // thuộc nó (picker là singleton toàn app).
  cancelPick(tabId?: string, scope?: string): void {
    const pending = this.pendingPick
    if (!pending) return
    if (tabId && pending.tabId !== tabId) return
    if (scope !== undefined) {
      const owner = this.tabs.get(pending.tabId)
      if (owner && owner.scope !== scope) return
    }
    pending.cancel()
  }

  async pageContext(tabId?: string, scope?: string): Promise<PageContext> {
    const tab = this.tab(tabId, scope)
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
  async saveScreenshot(root: string, tabId?: string, scope?: string): Promise<{ path: string }> {
    if (!root || !isAbsolute(root)) {
      throw new Error('saveScreenshot: workspace root must be an absolute path')
    }
    const tab = this.tab(tabId, scope)
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

  // Khung "đông cứng" cho renderer: khi một overlay DOM (context menu, dialog)
  // che viewport, view native phải ẩn đi để menu đọc/click được — và khoảng bên
  // dưới là một mảng trắng. Renderer chụp một frame JPEG phủ lên cho tới khi
  // view reattach. KHÁC saveScreenshot: đây là placeholder thoáng qua nên
  // downscale về đúng DIP của view + JPEG nhẹ, không phải PNG lưu đĩa. null khi
  // tab chưa từng có display surface (chưa hiện lần nào) — renderer giữ nền
  // trống như cũ.
  async frameDataUrl(tabId?: string, scope?: string): Promise<{ dataUrl: string | null }> {
    const tab = this.tab(tabId, scope)
    const img = await this.tryCapture(tab)
    if (!img) return { dataUrl: null }
    const bounds = tab.view.getBounds()
    const w = Math.round(bounds.width)
    const sized = w > 0 && img.getSize().width > w ? img.resize({ width: w }) : img
    // Đang giả lập thiết bị: view chỉ chiếm phần giữa của rect (xem
    // browser-emulation.ts) mà renderer phủ ảnh này lên TOÀN rect bằng
    // object-fit: fill — ảnh trần sẽ bị kéo méo. Đệm lại đúng kích thước rect bằng
    // pixel trong suốt (PNG) để phần letterbox vẫn là nền theme của renderer.
    const slot = tab.slot
    if (tab.emu && slot) {
      const padded = padToSlot(sized, bounds, slot)
      if (padded)
        return {
          dataUrl: `data:image/png;base64,${padded.toPNG().toString('base64')}`,
        }
    }
    return {
      dataUrl: `data:image/jpeg;base64,${sized.toJPEG(72).toString('base64')}`,
    }
  }

  // JPEG ~640px rộng, chất lượng 70 (≈ 20–60KB). Dùng `captureOrThrow` để tab chưa
  // từng lên màn hình vẫn được `ensurePainted` đánh thức, rồi nuốt lỗi → null.
  async thumbnail(tabId?: string, scope?: string): Promise<{ base64: string; width: number; height: number } | null> {
    const tab = this.tab(tabId, scope)
    try {
      const img = await this.captureOrThrow(tab)
      const w = img.getSize().width
      const sized = w > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH }) : img
      const { width, height } = sized.getSize()
      return {
        base64: sized.toJPEG(THUMB_QUALITY).toString('base64'),
        width,
        height,
      }
    } catch (err) {
      log.warn('browser thumbnail failed', {
        tab: tab.id,
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    }
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
    this.activeByScope.clear()
    if (this.popoutWin && !this.popoutWin.isDestroyed()) this.popoutWin.destroy()
    this.popoutWin = null
    if (this.holder && !this.holder.isDestroyed()) this.holder.destroy()
    this.holder = null
  }
}

export const browser = new BrowserController()

// Register the browser.* methods the sidecar invokes via hostRequest(). Each
// validates its params (main is also a trust boundary) and returns plain JSON.
// `scope` trong mọi params dưới đây là chủ sở hữu tab theo thiết kế per-session
// (session engineId từ chat, `task:<id>:<node>` từ workflow node). Nó đến TỪ
// SIDECAR — nơi biết lượt agent nào đang gọi — chứ không phải từ model: model
// chỉ nói "tab nào / action gì", tool wrapper gắn scope lên. Main check scope
// ↔ tab ownership ở `this.tab()` nên một agent không thể mượn tabId của session
// khác để đọc hay điều hướng trang đó.
export function registerBrowserHostHandlers(): void {
  // Sidecar đẩy tập cổng dev server ĐANG CHẠY + đã khai của một phiên (xem
  // browser-host-policy.ts). Thay thế nguyên tập; rỗng = thu hồi.
  engine.registerHostHandler('browser.setDevServerPorts', async (p) => {
    const ports = asObject(p).ports
    if (!Array.isArray(ports)) throw new Error('missing required param: ports')
    setDevServerPorts(requireString(p, 'scope'), ports as unknown[] as number[])
    return { ok: true }
  })
  // Sidecar chết ⇒ mọi khẳng định "đang chạy" hết căn cứ: thu hồi hết, sidecar
  // mới sẽ tự đẩy lại khi agent điều hướng.
  engine.onEvent((event) => {
    if (event.type === 'engine.crashed' || event.type === 'engine.restarted') {
      clearDevServerPorts()
    }
  })
  // Profile hiệu lực của một scope (session override ?? project ?? default) do
  // SIDECAR quyết — nó đẩy xuống mỗi khi có thể đổi và trước mỗi lượt browser_tool.
  // Đổi profile ⇒ tab của scope đóng + mở lại cùng URL ở partition mới.
  engine.registerHostHandler('browser.setScopeProfile', async (p) => {
    await browser.setScopeProfile(requireString(p, 'scope'), requireString(p, 'profile'))
    return { ok: true }
  })
  // Xoá sạch dữ liệu của một partition (profile bị xoá ở sidecar).
  engine.registerHostHandler('browser.wipeProfile', async (p) => {
    await browser.wipeProfile(requireString(p, 'profile'))
    return { ok: true }
  })
  // Tập userscript (luật đã biên dịch + source của script bật) do SIDECAR giữ.
  engine.registerHostHandler('browser.setUserscripts', async (p) => {
    userscripts.setScripts(p)
    return { ok: true }
  })
  // App mở / sidecar khởi động lại ⇒ kéo tập (lần đẩy trước có thể đã hụt).
  void userscripts.refresh()
  engine.onEvent((event) => {
    if (event.type === 'engine.restarted') void userscripts.refresh()
  })
  // Profile mặc định đổi (hoặc sidecar khởi động lại) ⇒ pool global có thể phải
  // chuyển partition.
  engine.onEvent((event) => {
    if (event.type === 'browser.profiles-changed' || event.type === 'engine.restarted') {
      void browser.refreshGlobalProfile()
      void browser.syncProxies()
    }
  })
  // Proxy (+ credential) của một profile do SIDECAR đẩy xuống: cấu hình ở file, credential
  // ở keychain. Main validate lại payload; credential chỉ giữ trong RAM.
  engine.registerHostHandler('browser.setProfileProxy', async (p) => {
    const o = asObject(p)
    const profile = requireString(p, 'profile')
    if (!isValidProfileId(profile)) throw new Error(`invalid browser profile id: ${profile}`)
    const proxy = o.proxy === null ? null : parseProxyConfig(o.proxy)
    const auth = o.auth === undefined ? undefined : parseProxyCredentials(o.auth)
    if (!proxy && auth) throw new Error('auth without proxy')
    if (proxy?.type === 'socks5' && auth) throw new Error('socks5 proxy authentication is not supported')
    await browser.setProfileProxy(profile, proxy, auth)
    return { ok: true }
  })
  // Khởi động: engine có thể đã chạy trước khi handler này đăng ký.
  void browser.syncProxies()
  engine.registerHostHandler('browser.navigate', async (p) =>
    browser.navigate(requireString(p, 'url'), optionalString(p, 'tabId'), optionalString(p, 'scope')),
  )
  engine.registerHostHandler('browser.click', async (p) =>
    browser.click(
      {
        selector: optionalString(p, 'selector'),
        ref: optionalString(p, 'ref'),
      },
      optionalString(p, 'tabId'),
      optionalString(p, 'scope'),
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
      optionalString(p, 'scope'),
    ),
  )
  engine.registerHostHandler('browser.extract', async (p) => {
    const o = asObject(p)
    const mode = o.mode === 'dom' ? 'dom' : 'text'
    return browser.extract(mode, optionalString(p, 'selector'), optionalString(p, 'tabId'), optionalString(p, 'scope'))
  })
  engine.registerHostHandler('browser.screenshot', async (p) =>
    browser.screenshot(optionalString(p, 'tabId'), optionalString(p, 'scope')),
  )
  // Ảnh xem trước cho thẻ trang trong transcript (docs/features/browser-preview-card.md).
  // Best-effort: chụp lỗi ⇒ null, KHÔNG ném — thẻ vẫn hiện được không có ảnh và
  // một lần chụp hỏng không được làm hỏng lượt `navigate`. Base64 chỉ đi về sidecar
  // để ghi đĩa; không bao giờ vào kết quả tool gửi cho model.
  engine.registerHostHandler('browser.thumbnail', async (p) =>
    browser.thumbnail(optionalString(p, 'tabId'), optionalString(p, 'scope')),
  )
  engine.registerHostHandler('browser.snapshot', async (p) =>
    browser.snapshot(optionalString(p, 'selector'), optionalString(p, 'tabId'), optionalString(p, 'scope')),
  )
  engine.registerHostHandler('browser.console', async (p) =>
    browser.readConsole(
      optionalString(p, 'level'),
      Math.max(1, Math.min(200, optionalNumber(p, 'limit') ?? 50)),
      optionalString(p, 'tabId'),
      optionalString(p, 'scope'),
    ),
  )
  engine.registerHostHandler('browser.network', async (p) =>
    browser.readNetwork(
      optionalString(p, 'filter'),
      Math.max(1, Math.min(200, optionalNumber(p, 'limit') ?? 50)),
      optionalString(p, 'tabId'),
      optionalString(p, 'scope'),
    ),
  )
  engine.registerHostHandler('browser.networkBody', async (p) =>
    browser.networkBody(requireString(p, 'requestId'), optionalString(p, 'tabId'), optionalString(p, 'scope')),
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
      optionalString(p, 'scope'),
    ),
  )
  engine.registerHostHandler('browser.tabs', async (p) => browser.listTabs(undefined, optionalString(p, 'scope')))
  engine.registerHostHandler('browser.tabNew', async (p) =>
    browser.newTab(optionalString(p, 'url'), true, optionalString(p, 'scope')),
  )
  engine.registerHostHandler('browser.tabSelect', async (p) =>
    browser.selectTab(requireString(p, 'tabId'), optionalString(p, 'scope')),
  )
  engine.registerHostHandler('browser.tabClose', async (p) =>
    browser.closeTab(requireString(p, 'tabId'), optionalString(p, 'scope')),
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
