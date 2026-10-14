// Phần THUẦN (không electron, không log) của userscript: kiểm tra payload từ sidecar,
// thử luật khớp URL, dựng wrapper chạy trong trang, đọc báo cáo. Tách khỏi
// browser-userscripts.ts để `node --test` nạp được mà không cần Electron.
// Tài liệu: docs/features/browser-userscripts.md

import { Script, createContext, type Context } from "node:vm";

export type RunAt = "document-start" | "document-end" | "document-idle";

export type UserscriptMeta = {
  name: string;
  namespace?: string;
  version?: string;
  description?: string;
  match: string[];
  include: string[];
  exclude: string[];
  runAt: RunAt;
  noframes: boolean;
  grant: string[];
  require: string[];
};

export type CompiledRule = { source: string; flags: string };

export type HostUserscript = {
  id: string;
  enabled: boolean;
  meta: UserscriptMeta;
  rules: { include: CompiledRule[]; exclude: CompiledRule[] };
  // Rỗng với script đang tắt.
  source: string;
};

const ID_RE = /^us-[0-9a-f]{8}$/;
const MAX_SCRIPTS = 200;
const MAX_SOURCE = 640 * 1024;
const MAX_RULE_SOURCE = 600;
const MAX_STRINGS = 200;
const MAX_STRING = 600;
const MAX_URL = 2_048;

// ─── Payload từ sidecar (main cũng là một biên tin cậy) ──────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new Error("userscript: not an object");
  return v as Record<string, unknown>;
}

function str(
  o: Record<string, unknown>,
  key: string,
  max = MAX_STRING,
): string {
  const v = o[key];
  if (typeof v !== "string" || v.length > max)
    throw new Error(`userscript: bad field ${key}`);
  return v;
}

function optStr(o: Record<string, unknown>, key: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, 2_000);
}

function strList(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length > MAX_STRINGS)
    throw new Error(`userscript: bad list ${key}`);
  return v.map((s) => {
    if (typeof s !== "string" || s.length > MAX_STRING)
      throw new Error(`userscript: bad item in ${key}`);
    return s;
  });
}

function ruleList(o: Record<string, unknown>, key: string): CompiledRule[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length > MAX_STRINGS)
    throw new Error(`userscript: bad rules ${key}`);
  return v.map((r) => {
    const rec = asRecord(r);
    const flags = str(rec, "flags", 8);
    if (!/^[imsu]*$/.test(flags)) throw new Error("userscript: bad rule flags");
    return { source: str(rec, "source", MAX_RULE_SOURCE), flags };
  });
}

// Ném khi payload sai hình dạng; không âm thầm bỏ phần hỏng để khỏi chạy tập lệch.
export function parseHostScripts(raw: unknown): HostUserscript[] {
  const list = asRecord(raw).scripts;
  if (!Array.isArray(list) || list.length > MAX_SCRIPTS)
    throw new Error("userscript: bad scripts list");
  return list.map((item) => {
    const o = asRecord(item);
    const id = str(o, "id", 16);
    if (!ID_RE.test(id)) throw new Error("userscript: bad id");
    const m = asRecord(o.meta);
    const runAt = str(m, "runAt", 20);
    if (
      runAt !== "document-start" &&
      runAt !== "document-end" &&
      runAt !== "document-idle"
    ) {
      throw new Error("userscript: bad runAt");
    }
    const meta: UserscriptMeta = {
      name: str(m, "name", 200),
      match: strList(m, "match"),
      include: strList(m, "include"),
      exclude: strList(m, "exclude"),
      runAt,
      noframes: m.noframes === true,
      grant: strList(m, "grant"),
      require: strList(m, "require"),
    };
    const namespace = optStr(m, "namespace");
    if (namespace !== undefined) meta.namespace = namespace;
    const version = optStr(m, "version");
    if (version !== undefined) meta.version = version;
    const description = optStr(m, "description");
    if (description !== undefined) meta.description = description;
    const r = asRecord(o.rules);
    return {
      id,
      enabled: o.enabled === true,
      meta,
      rules: {
        include: ruleList(r, "include"),
        exclude: ruleList(r, "exclude"),
      },
      source: str(o, "source", MAX_SOURCE),
    };
  });
}

// ─── So khớp ─────────────────────────────────────────────────────────────────

// Regex @include của người dùng có thể backtrack thảm hoạ; main KHÔNG được treo
// theo nó. Chạy trong vm với timeout — V8 ngắt được cả regex đang chạy.
const REGEX_TIMEOUT_MS = 25;
let sandbox: { rule: CompiledRule | null; href: string } | null = null;
let ctx: Context | null = null;
let testScript: Script | null = null;

function safeTest(rule: CompiledRule, href: string): boolean {
  if (!sandbox || !ctx || !testScript) {
    sandbox = { rule: null, href: "" };
    ctx = createContext(sandbox);
    testScript = new Script("new RegExp(rule.source, rule.flags).test(href)");
  }
  sandbox.rule = rule;
  sandbox.href = href;
  try {
    return testScript.runInContext(ctx, { timeout: REGEX_TIMEOUT_MS }) === true;
  } catch {
    return false;
  }
}

// (include) VÀ KHÔNG (exclude); chỉ http(s). Chạy luật đã biên dịch ở sidecar
// (`compileRules`) — đây chỉ là bộ chạy chúng, không phải bộ so khớp thứ hai.
export function matchesRules(r: HostUserscript["rules"], url: string): boolean {
  if (url.length > MAX_URL) return false;
  let href: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    href = u.href;
  } catch {
    return false;
  }
  if (r.exclude.some((x) => safeTest(x, href))) return false;
  return r.include.some((x) => safeTest(x, href));
}

// ─── Wrapper chạy trong trang ────────────────────────────────────────────────

// JSON an toàn để nhúng trong mã JS: U+2028/2029 từng là line terminator trong JS.
const js = (v: unknown): string =>
  JSON.stringify(v)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// Hàm bao: kiểm tra URL một lần nữa NGAY TRONG trang (CDP gắn script vào mọi
// document, kể cả iframe), tôn trọng @noframes và @run-at, và báo `ran`/`error` về
// main bằng console tag. Mã người dùng là thân của một function — KHÔNG
// `new Function`/eval để CSP của trang không chặn được. Chỉ GM_addStyle/GM_info
// (nếu khai @grant) + unsafeWindow được cấp; mọi GM_* khác không tồn tại.
export function buildWrapper(script: HostUserscript, tag: string): string {
  const { meta } = script;
  const cfg = {
    id: script.id,
    name: meta.name,
    tag,
    runAt: meta.runAt,
    noframes: meta.noframes,
    inc: script.rules.include.map((r) => [r.source, r.flags]),
    exc: script.rules.exclude.map((r) => [r.source, r.flags]),
    addStyle: meta.grant.includes("GM_addStyle"),
    giveInfo: meta.grant.includes("GM_info"),
    info: {
      scriptHandler: "AWOG",
      version: "1",
      script: {
        name: meta.name,
        namespace: meta.namespace ?? "",
        version: meta.version ?? "",
        description: meta.description ?? "",
        matches: meta.match,
        includes: meta.include,
        excludes: meta.exclude,
        grant: meta.grant,
        "run-at": meta.runAt,
        noframes: meta.noframes,
      },
    },
  };
  return `(function(){
var C = ${js(cfg)};
var dbg = console.debug.bind(console);
function report(ev, msg){ try { dbg(C.tag + JSON.stringify({ id: C.id, name: C.name, ev: ev, msg: msg })); } catch {} }
try {
  var proto = location.protocol;
  if (proto !== 'http:' && proto !== 'https:') return;
  if (C.noframes && window.top !== window) return;
  var href = location.href;
  var hit = function (r) { try { return new RegExp(r[0], r[1]).test(href); } catch { return false; } };
  if (!C.inc.some(hit) || C.exc.some(hit)) return;
} catch { return; }
function addStyle(css) {
  var el = document.createElement('style');
  el.textContent = String(css);
  var apply = function () {
    (document.head || document.documentElement).appendChild(el);
    if (!el.sheet && 'adoptedStyleSheets' in document) {
      try { var sh = new CSSStyleSheet(); sh.replaceSync(String(css)); document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sh]); } catch {}
    }
  };
  if (document.head || document.documentElement) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
  return el;
}
var body = function (unsafeWindow, GM_addStyle, GM_info) {
${script.source}
\n};
function go() {
  report('ran');
  try { body(window, C.addStyle ? addStyle : undefined, C.giveInfo ? C.info : undefined); }
  catch (e) { report('error', (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e))); }
}
var rs = document.readyState;
if (C.runAt === 'document-start') go();
else if (C.runAt === 'document-end') {
  if (rs === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
} else if (rs === 'complete') setTimeout(go, 0);
else window.addEventListener('load', function () { setTimeout(go, 0); }, { once: true });
})();
//# sourceURL=awog-userscript-${script.id}.user.js
`;
}

// Script có biên dịch được không? Lỗi cú pháp trong một script không được làm hỏng
// script khác nên kiểm trước khi đăng ký. `null` = ổn.
export function syntaxProblem(wrapper: string): string | null {
  try {
    new Script(wrapper);
    return null;
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}

// ─── Báo cáo từ trang ────────────────────────────────────────────────────────

export type UserscriptReport = {
  id: string;
  name: string;
  ev: "ran" | "error";
  msg: string;
};

export function isReportMessage(message: unknown, tag: string): boolean {
  return typeof message === "string" && message.startsWith(tag);
}

// Trang là L1 (nó đọc được console.debug và có thể giả báo cáo) — chỉ để hiển thị,
// mọi trường được kiểm và cắt.
export function parseReport(
  message: string,
  tag: string,
): UserscriptReport | null {
  if (!message.startsWith(tag)) return null;
  try {
    const o = asRecord(JSON.parse(message.slice(tag.length)));
    const id = o.id;
    const ev = o.ev;
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    if (ev !== "ran" && ev !== "error") return null;
    return {
      id,
      name: typeof o.name === "string" ? o.name.slice(0, 200) : id,
      ev,
      msg: typeof o.msg === "string" ? o.msg.slice(0, 500) : "",
    };
  } catch {
    return null;
  }
}
