// Guard for the design-token scale (see docs/features/native-macos-polish.md §4 W8,
// docs/decisions/0079-native-macos-shell-and-design-tokens.md).
//
// Scans components/ layouts/ pages/ assets/css/ and fails when a hand-written value
// is used where a token exists:
//   R1  border-radius: <n>px           → must be var(--r-*)   (or 50% / 0 / inherit)
//   R2  font-size: <n>rem              → must be var(--fs-*)  (px and em stay, see below)
//   R3  var(--code) outside CODE_SURFACES  → mono is for real code only
//
// NOT wired into `pnpm lint` yet. At the time of writing the codebase still has ~700
// radius sites and ~700 rem font-size sites pending the P2 codemod and ~114 files
// pending the P3 mono triage, so wiring this in would paint lint red everywhere.
// Wiring it into `lint` is the LAST step of Phase P4, once P2 and P3 have landed.
// Until then run it on demand:  pnpm check:tokens   (add --all to skip the cap)
//
// Node only, zero dependencies (same house style as scripts/inline-katex-fonts.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCAN_DIRS = ['components', 'layouts', 'pages', 'assets/css']
const SCAN_EXT = ['.vue', '.css']

// Generated vendor stylesheet (scripts/inline-katex-fonts.mjs) — KaTeX ships its own
// type scale in `em`; it is not ours to token-ise.
const SKIP_FILES = new Set(['assets/css/katex.css'])

// --- Rule 1: radius ---------------------------------------------------------------
// Scale declared at assets/css/prototype.css:25.
const RADIUS_TOKENS = [
  { maxPx: 7, token: '--r-xs', px: 6 },
  { maxPx: 9, token: '--r-sm', px: 8 },
  { maxPx: 12, token: '--r-btn', px: 10 },
  { maxPx: 14, token: '--r-card', px: 14 },
  { maxPx: 16, token: '--r-panel', px: 16 },
  { maxPx: Infinity, token: '--r-pill', px: 999 },
]

// --- Rule 2: type scale -----------------------------------------------------------
// `calc(var(--font-size-base) ± Npx)`, so every step lands on a whole pixel at any
// Appearance base 12→18 (rem steps produced half pixels — ADR 0079 D2).
// Reference column below is px at the default base of 13.
const TYPE_TOKENS = [
  { maxPx: 11, token: '--fs-xs', px: 11 },
  { maxPx: 12.5, token: '--fs-sm', px: 12 },
  { maxPx: 13.5, token: '--fs-md', px: 13 },
  { maxPx: 15, token: '--fs-lg', px: 15 },
  { maxPx: 18, token: '--fs-xl', px: 17 },
  { maxPx: 22, token: '--fs-2xl', px: 22 },
]
const REM_BASE_PX = 13 // --font-size-base default; only used to name a suggestion

// --- Rule 3: mono ------------------------------------------------------------------
// `var(--code)` is legitimate only where the text really is code: code blocks, diff
// viewers, terminals, log tails, file paths, SHAs, JSON viewers. Everywhere else mono
// is being used to line numbers up, which `font-variant-numeric: tabular-nums` on
// --sans does without the terminal look (ADR 0079 D3).
//
// PROVISIONAL: this list is the obvious core only. Phase P3 (mono triage, W5) walks
// all 114 files that currently reference var(--code) and finalises the list — expect
// entries to be added here in that pass.
// Entry forms: exact path, `dir/` prefix, or a `*` glob (matched against the path
// relative to apps/desktop/ui-next/, POSIX separators).
const CODE_SURFACES = [
  'assets/css/markdown.css', // code fence trong markdown render
  'components/common/PreviewModal.vue', // preview nội dung file (text/code)
  'components/common/PreviewToolbar.vue', // đường dẫn file trên toolbar preview
  'components/editor/EditorViewerPane.vue', // viewer code cạnh Monaco
  'components/git/GitConflictBlock.vue', // hunk conflict
  'components/git/GitConflictResolver.vue', // hunk conflict
  'components/git/GitDiffLine.vue', // dòng diff
  'components/project/ProjectGhFileDiff.vue', // diff của PR trên GitHub
  'components/session/SessionCodeView.vue', // code block trong transcript
  'components/session/workspace/WorkspaceDiff.vue', // tab Diff
  'components/session/workspace/WorkspaceTerminal.vue', // tab Terminal (xterm)
  'components/settings/SettingsLogTail.vue', // log tail
  'components/shell/GlobalTerminalHost.vue', // terminal toàn cục
  'components/shell/TerminalSnippetEditor.vue', // snippet = lệnh shell
  'components/shell/TerminalSnippetsRail.vue', // snippet = lệnh shell
  'components/ssh/SshSftpBrowser.vue', // đường dẫn file từ xa
  'components/vpn/VpnLogModal.vue', // log OpenVPN
]

// --- Ngoại lệ cố ý (docs/features/native-macos-polish.md §8) -----------------------
// Không phải vi phạm, guard phải im lặng:
//   • `border-radius: 50%` (63 site) — vòng tròn (avatar, dot, spinner), không có
//     token nào biểu diễn được; `0` / `inherit` cũng hợp lệ.
//   • `font-size: <n>px` (221 site, hầu hết `12px`) — badge/hint/count chip CỐ Ý
//     không scale theo Appearance, theo .claude/rules/nuxt-vue.md.
//   • `font-size` đơn vị `em` (~150 site) — tương đối với cha; map sang token tuyệt
//     đối là đổi ngữ nghĩa, không phải token hoá.
//   • `font-size: 2.4615rem` (32px) — hero / empty state, một site duy nhất, giữ.
const HERO_REM = 2.4615

const RE_RADIUS = /(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;}\n]+)/g
const RE_FONT_SIZE = /(font-size)\s*:\s*([^;}\n]+)/g
const RE_CODE_VAR = /var\(\s*--code\s*\)/

const pickToken = (scale, px) => scale.find((s) => px <= s.maxPx) ?? scale[scale.length - 1]

/** Mask `/* … *\/` comments with spaces so line numbers stay intact. */
const maskBlockComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      yield* walk(abs)
      continue
    }
    if (SCAN_EXT.some((ext) => entry.endsWith(ext))) yield abs
  }
}

const isCodeSurface = (relPath) =>
  CODE_SURFACES.some((entry) => {
    if (entry.endsWith('/')) return relPath.startsWith(entry)
    if (entry.includes('*')) {
      const re = new RegExp(
        `^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
      )
      return re.test(relPath)
    }
    return relPath === entry
  })

function checkRadius(value) {
  if (/(-?\d*\.?\d+)px/.test(value)) {
    // Rewrite in place so shorthand keeps its shape: `3px 3px 0 0` → `var(--r-xs) var(--r-xs) 0 0`.
    const hint = value
      .trim()
      .replace(/(-?\d*\.?\d+)px/g, (m, n) =>
        Number(n) === 0 ? '0' : `var(${pickToken(RADIUS_TOKENS, Number(n)).token})`,
      )
    return `dùng \`${hint}\` thay vì \`${value.trim()}\``
  }
  // `var(--r)` (13 site) không hề được khai ở đâu — biến không tồn tại nên
  // border-radius rơi về 0. Đây là lỗi thật, không phải ngoại lệ.
  if (/var\(\s*--r\s*\)/.test(value)) {
    return `\`var(--r)\` KHÔNG được khai báo ở đâu (radius rơi về 0) — chọn một token \`--r-*\``
  }
  return null
}

function checkFontSize(value) {
  const rem = [...value.matchAll(/(\d*\.?\d+)rem/g)].map((m) => Number(m[1]))
  if (!rem.length) return null
  if (rem.length === 1 && rem[0] === HERO_REM) return null // hero / empty state
  // Round to 0.1px trước khi map: rem lẻ cho ra 11.0006 / 12.4995, đúng ra là 11 / 12.5.
  const toPx = (r) => Math.round(r * REM_BASE_PX * 10) / 10
  const hint = rem.map((r) => `var(${pickToken(TYPE_TOKENS, toPx(r)).token})`).join(' ')
  const px = rem.map((r) => `${toPx(r)}px`).join(' ')
  return `dùng \`${hint}\` thay vì \`${value.trim()}\` (= ${px} @base${REM_BASE_PX})`
}

const violations = { radius: [], type: [], mono: [] }

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir)
  for (const file of walk(abs)) {
    const relPath = relative(ROOT, file).split(sep).join('/')
    if (SKIP_FILES.has(relPath)) continue

    const lines = maskBlockComments(readFileSync(file, 'utf8')).split('\n')
    const codeSurface = isCodeSurface(relPath)

    lines.forEach((line, i) => {
      const at = { file: relPath, line: i + 1 }

      for (const [, prop, value] of line.matchAll(RE_RADIUS)) {
        const hint = checkRadius(value)
        if (hint) violations.radius.push({ ...at, text: `${prop}: ${value.trim()}`, hint })
      }

      for (const [, prop, value] of line.matchAll(RE_FONT_SIZE)) {
        const hint = checkFontSize(value)
        if (hint) violations.type.push({ ...at, text: `${prop}: ${value.trim()}`, hint })
      }

      if (!codeSurface && RE_CODE_VAR.test(line)) {
        violations.mono.push({
          ...at,
          text: line.trim(),
          hint: 'không phải code thật → dùng `var(--sans)` + class `.tnum` (tabular-nums); nếu đúng là code, thêm file vào CODE_SURFACES',
        })
      }
    })
  }
}

const all = process.argv.includes('--all')
const CAP = 40

const RULES = [
  { key: 'radius', title: 'R1  border-radius không dùng token --r-*' },
  { key: 'type', title: 'R2  font-size dùng rem thay vì token --fs-*' },
  { key: 'mono', title: 'R3  var(--code) ngoài danh sách bề mặt code' },
]

let total = 0
for (const rule of RULES) {
  const list = violations[rule.key]
  total += list.length
  if (!list.length) continue
  process.stdout.write(`\n${rule.title} — ${list.length} vi phạm\n`)
  for (const v of all ? list : list.slice(0, CAP)) {
    process.stdout.write(`  ${v.file}:${v.line}  ${v.text}\n      → ${v.hint}\n`)
  }
  if (!all && list.length > CAP) {
    process.stdout.write(`  … +${list.length - CAP} nữa (chạy với --all để xem hết)\n`)
  }
}

if (!total) {
  process.stdout.write('check-design-tokens: OK — không có vi phạm.\n')
  process.exit(0)
}

process.stdout.write(
  `\ncheck-design-tokens: ${total} vi phạm ` +
    `(radius ${violations.radius.length}, type ${violations.type.length}, mono ${violations.mono.length}).\n` +
    'Xem docs/features/native-macos-polish.md §4 (W3/W4/W5) để biết bảng map token.\n',
)
process.exit(1)
