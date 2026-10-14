// Parser metadata `// ==UserScript==` + bộ so khớp URL cho userscript của trình
// duyệt nhúng. Thuần hàm — không I/O — để test được và để Electron main nhận
// luật đã biên dịch (`CompiledRules`) thay vì tự cài lại một bộ so khớp thứ hai.
// Tài liệu: docs/features/browser-userscripts.md

export const RUN_AT_VALUES = [
  "document-start",
  "document-end",
  "document-idle",
] as const;
export type RunAt = (typeof RUN_AT_VALUES)[number];

// Chỉ những grant này có thật lúc chạy; mọi grant khác chỉ sinh cảnh báo.
export const SUPPORTED_GRANTS = [
  "none",
  "GM_addStyle",
  "GM_info",
  "unsafeWindow",
] as const;

const MAX_NAME_LENGTH = 200;
const MAX_RULE_LENGTH = 500;
const MAX_RULES_PER_KIND = 100;

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

export class UserscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserscriptError";
  }
}

// ─── Parser ──────────────────────────────────────────────────────────────────

const HEADER_RE =
  /\/\/[ \t]*==UserScript==[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\/\/[ \t]*==\/UserScript==/;
const LINE_RE = /^[ \t]*\/\/[ \t]*@([A-Za-z][\w:-]*)(?:[ \t]+(.*?))?[ \t]*$/;

export type ParsedUserscript = { meta: UserscriptMeta; warnings: string[] };

// Ném `UserscriptError` khi thiếu khối header hoặc thiếu `@name` — hai thứ khiến
// một file không phải userscript dùng được. Mọi lỗi nhẹ hơn thành `warnings`.
export function parseUserscript(source: string): ParsedUserscript {
  const block = HEADER_RE.exec(source);
  if (!block)
    throw new UserscriptError(
      "Missing // ==UserScript== … // ==/UserScript== header",
    );
  const warnings: string[] = [];
  const values = new Map<string, string[]>();
  for (const line of (block[1] ?? "").split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const list = values.get(key) ?? [];
    list.push(m[2] ?? "");
    values.set(key, list);
  }
  const first = (key: string): string | undefined => {
    const v = values.get(key)?.[0]?.trim();
    return v ? v : undefined;
  };
  const all = (key: string): string[] =>
    (values.get(key) ?? []).map((v) => v.trim()).filter((v) => v.length > 0);

  const name = first("name");
  if (!name) throw new UserscriptError("Missing required @name");
  if (name.length > MAX_NAME_LENGTH) {
    throw new UserscriptError(
      `@name is longer than ${MAX_NAME_LENGTH} characters`,
    );
  }

  let runAt: RunAt = "document-end";
  const runAtRaw = first("run-at");
  if (runAtRaw !== undefined) {
    // Tampermonkey cũng nhận `context-menu` + dạng `document_start`; chỉ ba giá
    // trị còn lại có nghĩa ở đây.
    const normalized = runAtRaw.replace(/_/g, "-").toLowerCase();
    if ((RUN_AT_VALUES as readonly string[]).includes(normalized))
      runAt = normalized as RunAt;
    else
      warnings.push(`Unsupported @run-at "${runAtRaw}" — using document-end`);
  }

  const grant = all("grant");
  for (const g of grant) {
    if (!(SUPPORTED_GRANTS as readonly string[]).includes(g)) {
      warnings.push(
        `Unsupported @grant ${g} — this API is undefined at runtime`,
      );
    }
  }
  const require = all("require");
  for (const r of require)
    warnings.push(`@require is not supported and was not loaded: ${r}`);

  const meta: UserscriptMeta = {
    name,
    match: all("match").slice(0, MAX_RULES_PER_KIND),
    include: all("include").slice(0, MAX_RULES_PER_KIND),
    exclude: all("exclude").slice(0, MAX_RULES_PER_KIND),
    runAt,
    noframes: values.has("noframes"),
    grant,
    require,
  };
  const namespace = first("namespace");
  if (namespace !== undefined) meta.namespace = namespace;
  const version = first("version");
  if (version !== undefined) meta.version = version;
  const description = first("description");
  if (description !== undefined) meta.description = description;

  const compiled = compileRules(meta);
  warnings.push(...compiled.warnings);
  if (compiled.include.length === 0) {
    warnings.push("No valid @match/@include rule — the script will never run");
  }
  return { meta, warnings };
}

// ─── Luật so khớp ────────────────────────────────────────────────────────────

// Regex dạng chuỗi để đi qua JSON sang main rồi vào trang (`new RegExp(source, flags)`).
// Mọi luật được thử trên `href` ĐẦY ĐỦ (đã chuẩn hoá bởi `new URL`).
export type CompiledRule = { source: string; flags: string };

export type CompiledRules = {
  include: CompiledRule[];
  exclude: CompiledRule[];
  // Luật hỏng bị bỏ qua và kể ở đây (parser đưa vào `warnings`).
  warnings: string[];
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// Host trong URL không có userinfo/port ở nhóm wildcard: port có mệnh đề riêng.
const HOST_CHARS = "[^/?#@:]+";
const MATCH_RE = /^(\*|https?):\/\/([^/]*)(\/.*)$/;

// Chrome match pattern → regex. Chỉ http(s) (userscript không chạy ở scheme khác);
// `file`, `ftp`… là lỗi. `*` ở scheme = http|https. Host: `*` · `*.x.y` (x.y và mọi
// subdomain) · tên chính xác, kèm `:port` tuỳ chọn (không có port = mọi port, như
// Chrome). Path là glob `*`; fragment luôn được bỏ qua.
export function compileMatchPattern(pattern: string): CompiledRule | string {
  if (pattern.length > MAX_RULE_LENGTH) return "pattern too long";
  if (pattern === "<all_urls>") {
    return { source: `^https?://${HOST_CHARS}(?::\\d+)?/.*$`, flags: "" };
  }
  const m = MATCH_RE.exec(pattern);
  if (!m) return "not a valid match pattern (scheme://host/path)";
  const scheme = m[1] === "*" ? "https?" : (m[1] ?? "");
  const hostPart = (m[2] ?? "").toLowerCase();
  const path = m[3] ?? "/";

  let hostRe: string;
  let portRe = "(?::\\d+)?";
  const portAt = /:(\d+|\*)$/.exec(hostPart);
  let host = hostPart;
  if (portAt) {
    host = hostPart.slice(0, portAt.index);
    if (portAt[1] !== "*") portRe = `:${portAt[1]}`;
  }
  const bare = host.startsWith("*.") ? host.slice(2) : host;
  if (host === "*") hostRe = HOST_CHARS;
  else if (bare.length === 0) return "empty host";
  else if (bare.includes("*"))
    return '"*" is only allowed as the whole host or a leading "*."';
  else
    hostRe =
      bare === host
        ? escapeRegex(host)
        : `(?:${HOST_CHARS}\\.)*${escapeRegex(bare)}`;

  const pathRe = path.split("*").map(escapeRegex).join(".*");
  return {
    source: `^${scheme}://${hostRe}${portRe}${pathRe}(?:#.*)?$`,
    flags: "",
  };
}

// @include/@exclude: `/regex/flags` hoặc glob `*` (không phân biệt hoa/thường như
// Tampermonkey). `g`/`y` bị bỏ vì chúng làm `test()` có trạng thái.
export function compileGlobOrRegex(rule: string): CompiledRule | string {
  if (rule.length > MAX_RULE_LENGTH) return "rule too long";
  const rx = /^\/(.+)\/([a-z]*)$/s.exec(rule);
  if (rx) {
    const flags = [
      ...new Set((rx[2] ?? "").split("").filter((f) => "imsu".includes(f))),
    ].join("");
    try {
      new RegExp(rx[1] ?? "", flags);
    } catch (err) {
      return `invalid regular expression (${err instanceof Error ? err.message : String(err)})`;
    }
    return { source: rx[1] ?? "", flags };
  }
  return {
    source: `^${rule.split("*").map(escapeRegex).join(".*")}$`,
    flags: "i",
  };
}

export function compileRules(
  meta: Pick<UserscriptMeta, "match" | "include" | "exclude">,
): CompiledRules {
  const warnings: string[] = [];
  const include: CompiledRule[] = [];
  const exclude: CompiledRule[] = [];
  const add = (
    into: CompiledRule[],
    kind: string,
    rule: string,
    compile: (r: string) => CompiledRule | string,
  ): void => {
    const res = compile(rule);
    if (typeof res === "string")
      warnings.push(`Invalid ${kind} ignored: ${rule} — ${res}`);
    else into.push(res);
  };
  for (const r of meta.match) add(include, "@match", r, compileMatchPattern);
  for (const r of meta.include) add(include, "@include", r, compileGlobOrRegex);
  for (const r of meta.exclude) add(exclude, "@exclude", r, compileGlobOrRegex);
  return { include, exclude, warnings };
}

const testRule = (rule: CompiledRule, href: string): boolean =>
  new RegExp(rule.source, rule.flags).test(href);

// Chạy trên URL này không? Chỉ http(s); (@match ∪ @include) VÀ KHÔNG @exclude —
// @exclude luôn thắng.
export function matchesUserscript(
  meta: Pick<UserscriptMeta, "match" | "include" | "exclude">,
  url: string,
): boolean {
  let href: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    href = u.href;
  } catch {
    return false;
  }
  const rules = compileRules(meta);
  if (rules.exclude.some((r) => testRule(r, href))) return false;
  return rules.include.some((r) => testRule(r, href));
}
