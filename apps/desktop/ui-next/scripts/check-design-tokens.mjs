// Guard for the design-token scale (see docs/features/native-macos-polish.md §4 W8,
// docs/decisions/0079-native-macos-shell-and-design-tokens.md).
//
// Scans components/ layouts/ pages/ assets/css/ and fails when a hand-written value
// is used where a token exists:
//   R1  border-radius: <n>px           → must be var(--r-*)   (or 50% / 0 / inherit)
//   R2  font-size: <n>rem              → must be var(--fs-*)  (px and em stay, see below)
//   R3  var(--code) outside CODE_SURFACES / a `mono-ok` marker → mono is for real code
//
// P2 (radius + type codemods) and P3 (mono triage) have landed, so all three rules now
// report zero. Wiring it into `pnpm lint` is the last step of Phase P4; until then run
// it on demand:  pnpm check:tokens   (add --all to skip the 40-line cap)
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
// was being used to line numbers up, which `font-variant-numeric: tabular-nums` on
// --sans does without the terminal look (ADR 0079 D3).
//
// FINAL after the P3 triage (docs/features/native-macos-polish.md §4 W5). The list is
// short on purpose: it holds only files whose EVERY mono rule is code, so an entry can
// never quietly wave through a count badge that happens to live in the same file. A
// single code rule inside an otherwise-normal component takes a `mono-ok: <reason>`
// marker on the rule instead (see MONO_OK below) — that is the common case, ~50 of
// them, and it documents the decision where the decision applies.
//
// Entry forms: exact path, `dir/` prefix, or a `*` glob (matched against the path
// relative to apps/desktop/ui-next/, POSIX separators).
const CODE_SURFACES = [
  // Diff + code rendering, top to bottom: every rule in these files styles source text.
  'components/editor/EditorViewerPane.vue', // diff / code pane beside Monaco
  'components/project/ProjectGhFileDiff.vue', // diff of a file in a GitHub PR
  'components/session/SessionCodeView.vue', // code + diff block inside the transcript
  // Terminals. WorkspaceTerminal currently takes its font from Appearance
  // (`term.options.fontFamily`) and has no `var(--code)` at all — it stays listed
  // because any CSS mono added to an xterm host IS correct: a proportional font there
  // breaks xterm's character-cell grid outright.
  'components/session/workspace/WorkspaceTerminal.vue', // xterm host
  'components/shell/GlobalTerminalHost.vue', // global terminal chrome + cwd path
  'components/shell/TerminalSnippetEditor.vue', // snippet body = a shell command
  // Log tails — raw process output, column-aligned by the producer.
  'components/settings/SettingsLogTail.vue', // engine log
  'components/vpn/VpnLogModal.vue', // OpenVPN log
  // Remote filesystem: every label in it is a path segment.
  'components/ssh/SshSftpBrowser.vue', // SFTP browser
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

// A declaration opts out with a `<marker>: <reason>` note on its own line, or in the
// comment block sitting directly above it.
//
//   design-token-ok — R1/R2. The raw px IS the geometry: a text caret, a 9px legend
//                     square, the near-square corner forming a speech-bubble tail.
//   mono-ok         — R3. This one rule really does render code, inside a file that is
//                     mostly not code (prototype.css holds the whole design system;
//                     SessionComposer holds one file-path chip). Files that are code
//                     surfaces end to end go in CODE_SURFACES instead.
const OPT_OUT = 'design-token-ok'
const MONO_OK = 'mono-ok'

function isMarked(rawLines, maskedLines, index, marker) {
  if (rawLines[index]?.includes(marker)) return true
  // Walk up through the comment block above: masking blanks a comment-only line, so
  // any line with code on it (or a blank separator) ends the block.
  for (let i = index - 1; i >= 0; i--) {
    if (maskedLines[i].trim() !== '') return false
    if (rawLines[i].includes(marker)) return true
    if (rawLines[i].trim() === '') return false
  }
  return false
}

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

    const src = readFileSync(file, 'utf8')
    const rawLines = src.split('\n')
    const lines = maskBlockComments(src).split('\n')
    const codeSurface = isCodeSurface(relPath)

    lines.forEach((line, i) => {
      // Hand-synced with scripts/lib/css-sites.mjs — see the note there.
      const at = { file: relPath, line: i + 1 }
      const optedOut = isMarked(rawLines, lines, i, OPT_OUT)

      if (!optedOut) {
        for (const [, prop, value] of line.matchAll(RE_RADIUS)) {
          const hint = checkRadius(value)
          if (hint) violations.radius.push({ ...at, text: `${prop}: ${value.trim()}`, hint })
        }

        for (const [, prop, value] of line.matchAll(RE_FONT_SIZE)) {
          const hint = checkFontSize(value)
          if (hint) violations.type.push({ ...at, text: `${prop}: ${value.trim()}`, hint })
        }
      }

      if (!codeSurface && RE_CODE_VAR.test(line) && !isMarked(rawLines, lines, i, MONO_OK)) {
        violations.mono.push({
          ...at,
          text: line.trim(),
          hint:
            'không phải code thật → bỏ `font-family` (kế thừa `--sans`), thêm ' +
            '`font-variant-numeric: tabular-nums` nếu có số cần thẳng cột. Nếu ĐÚNG là code: ' +
            'thêm `mono-ok: <lý do>` cho một rule, hoặc thêm file vào CODE_SURFACES nếu cả file là bề mặt code',
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
