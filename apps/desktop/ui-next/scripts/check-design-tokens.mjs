// Guard for the design-token scale (see docs/features/native-macos-polish.md §4 W8,
// docs/decisions/0079-native-macos-shell-and-design-tokens.md).
//
// Scans components/ layouts/ pages/ assets/css/ and fails when a hand-written value
// is used where a token exists:
//   R1  border-radius: <n>px           → must be var(--r-*)   (or 50% / 0 / inherit)
//   R2  font-size: <n>rem              → must be var(--fs-*)  (px and em stay, see below)
//   R3  var(--code) outside CODE_SURFACES / a `mono-ok` marker → mono is for real code
//   R4  line-height: <fractional coefficient>   → must be var(--lh-*) or a whole px
//   R5  icon size on an ODD px      → must be var(--icon-*) or an even px
//   R6  padding/margin/gap on an ODD px  → must be even (±1px stays)
//
// Runs as part of `pnpm lint`; on demand it is  pnpm check:tokens  (add --all to skip the
// 40-line cap). R1–R3 report zero outright. R4 reports zero against a per-file CEILING of
// pre-existing coefficients (LEGACY_COEFFICIENTS) that still needs a human pass — new code
// is held to the rule, the backlog can only shrink.
//
// Node only, zero dependencies (same house style as scripts/inline-katex-fonts.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// R5 is the ONE rule that imports instead of keeping its own copy (see the note above
// SCAN_DIRS): telling an icon apart from a dot / swatch / skeleton bar needs the template
// evidence learnIconClasses() collects, and two drifting copies of that would let the
// codemod rewrite sites this guard never checks.
import {
  ICON_SCALE,
  ICON_TOKENS,
  MAX_ICON_PX,
  iconSites,
  iconTargetFor,
  learnIconClasses,
} from './lib/icon-sites.mjs'

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

// --- Rule 4: leading ---------------------------------------------------------------
// Scale declared next to --fs-* at assets/css/prototype.css.
//
// A UNITLESS line-height is a coefficient: it multiplies whatever font-size the element
// resolves to, so `1.5` on the 13px body is 19.5px and the type scale's whole pixels come
// straight back out as halves. A baseline on a half pixel is what makes macOS paint the
// glyphs — and the hairline next to them — soft (ADR 0079 D2). A line-height WITH a unit
// also inherits as a fixed LENGTH, so a child that only sets font-size still lands on a
// whole pixel instead of re-multiplying.
//
// Legal: var(--lh-*) · a whole px · an INTEGER coefficient (integer x integer px is still
// an integer, which is why the `line-height: 1` used on icon buttons is fine) · the CSS-wide
// keywords. Everything else — fractional coefficients, fractional px, em/%/normal — either
// is a half pixel already or becomes one at some Appearance base.
const LH_TOKENS = ['--lh-xs', '--lh-sm', '--lh-md', '--lh-lg', '--lh-xl', '--lh-2xl', '--lh-prose']

// Pre-existing fractional coefficients, counted per file on 2026-09-06 — the guard was
// added AFTER them, and rewriting a leading the author tuned by eye is a visual change
// that needs a human, not a codemod (the pairing codemod deliberately skips any rule that
// already states a leading). The allowance is a CEILING: a file may lose sites, never gain
// them, so new code is held to the rule while the backlog is worked down file by file.
// Delete an entry once its file is clean. Ngoại lệ một-lần (không phải nợ) dùng marker
// `design-token-ok` ngay tại dòng thay vì vào bảng này.
const LEGACY_COEFFICIENTS = new Map([
  ['assets/css/app-shell.css', 3], // 1.2 · 1.25 · 1.4
  ['assets/css/prototype.css', 26], // 1.7 x4 · 1.6 x3 · 2.1 x2 · 1.5 x4 · 1.65 x3 · 1.75 · 1.4 x3 · 1.55 x2 · 1.35 · 1.62 x2 · 1.72
  ['assets/css/theme-cute.css', 4], // 1.55 · 1.4 · 1.65 · 1.6
  ['components/activity/ActivityView.vue', 1], // 1.15
  ['components/agent/AgentBodyEditModal.vue', 2], // 1.55 x2
  ['components/agent/AgentDetail.vue', 2], // 1.6 · 1.5
  ['components/agent/AgentEditor.vue', 2], // 1.55 · 1.5
  ['components/command/CommandBodyEditModal.vue', 2], // 1.55 x2
  ['components/command/CommandDetail.vue', 1], // 1.6
  ['components/command/CommandEditor.vue', 1], // 1.55
  ['components/command/CommandPromptCreator.vue', 2], // 1.55 x2
  ['components/common/MinimizeDock.vue', 1], // 1.25
  ['components/common/PreviewModal.vue', 2], // 1.35 · 1.5
  ['components/common/SelectionTranslatePopover.vue', 2], // 1.4 · 1.5
  ['components/connection/ConnectionAddPicker.vue', 2], // 1.4 x2
  ['components/connection/ConnectionDetail.vue', 6], // 1.5 x3 · 1.6 · 1.4 · 1.55
  ['components/connection/ConnectionEditor.vue', 2], // 1.5 · 1.55
  ['components/connection/ConnectionSecretPanel.vue', 1], // 1.5
  ['components/connection/ConnectionToolsLog.vue', 1], // 1.5
  ['components/git/GitAuthErrorModal.vue', 2], // 1.5 · 1.45
  ['components/git/GitBranchDeleteModal.vue', 1], // 1.5
  ['components/git/GitInitEmptyState.vue', 1], // 1.5
  ['components/git/GitPrSummaryModal.vue', 2], // 1.55 · 1.6
  ['components/hook/HookConfigEditModal.vue', 2], // 1.55 x2
  ['components/hook/HookDetail.vue', 2], // 1.6 · 1.55
  ['components/hook/HookEditor.vue', 1], // 1.55
  ['components/hook/HookPromptCreator.vue', 3], // 1.55 x3
  ['components/hook/HookScriptEditModal.vue', 2], // 1.55 x2
  ['components/library/LibraryConfirmDelete.vue', 1], // 1.6
  ['components/library/LibraryCreatorPanel.vue', 3], // 1.6 x2 · 1.55
  ['components/library/LibraryImportModal.vue', 1], // 1.5
  ['components/onboarding/steps/StepAccount.vue', 2], // 1.5 x2
  ['components/onboarding/steps/StepAppearance.vue', 1], // 1.5
  ['components/onboarding/steps/StepProject.vue', 2], // 1.5 x2
  ['components/onboarding/TourHost.vue', 1], // 1.5
  ['components/pet/PetHud.vue', 1], // 1.35
  ['components/project/ProjectEditor.vue', 2], // 1.5 · 1.55
  ['components/project/ProjectGhComposer.vue', 2], // 1.5 · 1.6
  ['components/project/ProjectGhFileDiff.vue', 2], // 1.55 x2
  ['components/project/ProjectLlmDefaultsModal.vue', 1], // 1.5
  ['components/rule/RuleBodyEditModal.vue', 2], // 1.55 x2
  ['components/rule/RuleDetail.vue', 1], // 1.6
  ['components/rule/RuleEditor.vue', 1], // 1.55
  ['components/rule/RulePromptCreator.vue', 2], // 1.55 x2
  ['components/session/SessionBackgroundChips.vue', 1], // 1.2
  ['components/session/SessionComposer.vue', 1], // 1.4
  ['components/session/SessionDetail.vue', 2], // 1.4 x2
  ['components/session/SessionExportModal.vue', 3], // 1.5 · 1.55 x2
  ['components/session/SessionGateCard.vue', 1], // 1.5
  ['components/session/SessionMessageItem.vue', 1], // 1.5
  ['components/session/SessionPromptEditOverlay.vue', 1], // 1.6
  ['components/session/SessionStepItem.vue', 1], // 1.6
  ['components/session/SessionTurnFullscreen.vue', 1], // 1.5
  ['components/session/SessionWelcome.vue', 2], // 1.6 · 1.45
  ['components/session/workspace/WorkspaceCost.vue', 1], // 1.1
  ['components/settings/SettingsCodexDialog.vue', 1], // 1.55
  ['components/settings/SettingsDeviceAccess.vue', 1], // 1.5
  ['components/settings/SettingsDevicePairModal.vue', 1], // 1.5
  ['components/settings/SettingsDevices.vue', 4], // 1.5 x4
  ['components/settings/SettingsLogTail.vue', 1], // 1.5
  ['components/settings/SettingsMemory.vue', 2], // 1.5 x2
  ['components/settings/SettingsOAuthDialog.vue', 1], // 1.5
  ['components/settings/SettingsPaneHeader.vue', 2], // 1.3 · 1.55
  ['components/settings/SettingsPet.vue', 1], // 1.5
  ['components/shell/TerminalSnippetEditor.vue', 1], // 1.5
  ['components/shell/TopBarNotifications.vue', 1], // 1.35
  ['components/skill/SkillBodyEditModal.vue', 2], // 1.55 x2
  ['components/skill/SkillDetail.vue', 1], // 1.6
  ['components/skill/SkillEditor.vue', 1], // 1.55
  ['components/ssh/SftpChownModal.vue', 1], // 1.5
  ['components/ssh/SshEditor.vue', 1], // 1.3
  ['components/ssh/SshEmptyState.vue', 1], // 1.5
  ['components/ssh/SshHostKeyModal.vue', 1], // 1.6
  ['components/ssh/SshIdentityEditor.vue', 1], // 1.5
  ['components/ssh/SshImportPicker.vue', 1], // 1.5
  ['components/ssh/SshSnippetEditor.vue', 1], // 1.5
  ['components/task/DirtyWorkspaceWarnModal.vue', 1], // 1.6
  ['components/task/NewTaskModal.vue', 1], // 1.5
  ['components/task/TaskDetail.vue', 1], // 1.6
  ['components/task/TaskPhaseCard.vue', 2], // 1.55 · 1.5
  ['components/templates/FetchFromGithubDialog.vue', 1], // 1.5
  ['components/templates/SaveAsTemplateDialog.vue', 1], // 1.55
  ['components/templates/TemplateDetail.vue', 1], // 1.6
  ['components/vpn/VpnChallengeModal.vue', 1], // 1.4
  ['components/vpn/VpnEditor.vue', 1], // 1.3
  ['components/vpn/VpnEmptyState.vue', 1], // 1.5
  ['components/vpn/VpnLogModal.vue', 1], // 1.5
  ['components/WhatsNewModal.vue', 3], // 1.55 x2 · 1.5
  ['components/wiki/WikiImportModal.vue', 1], // 1.5
  ['components/wiki/WikiReader.vue', 1], // 1.25
  ['components/wiki/WikiSidebar.vue', 2], // 1.5 · 1.4
  ['components/workflow/WorkflowInspector.vue', 2], // 1.5 x2
  ['components/workflow/WorkflowPromptCreator.vue', 2], // 1.55 · 1.5
  ['pages/connections.vue', 1], // 1.6
  ['pages/pet.vue', 1], // 1.35
  ['pages/tray-popover.vue', 1], // 1.15
  ['pages/wiki.vue', 1], // 1.6
])

const RE_RADIUS = /(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;}\n]+)/g
const RE_FONT_SIZE = /(font-size)\s*:\s*([^;}\n]+)/g
const RE_CODE_VAR = /var\(\s*--code\s*\)/
// Stops at ` " ' ` too, so an inline `style="line-height: 1.5"` in a template is read as
// one declaration instead of swallowing the rest of the attribute.
const RE_LINE_HEIGHT = /(line-height)\s*:\s*([^;}"'\n]+)/g
// R6. Hand-synced with scripts/codemod-spacing.mjs — if the two predicates drift, the
// guard reports sites the codemod cannot fix (or waves through sites it rewrites).
// `(?<![-\w])` keeps `scroll-padding` and camelCase `marginTop` (JS style objects) out.
const RE_SPACING =
  /(?<![-\w])((?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap)\s*:\s*([^;}"'\n]+)/g

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

/** The declaration list around `index`, as one string. Walks out to the nearest `{` above
 *  and `}` below, which is enough to find the rule's own font-size in both shapes the repo
 *  uses (compact one-rule-per-line in prototype.css, one-declaration-per-line elsewhere).
 *  Suggestion quality only — never correctness. */
function enclosingRule(rawLines, index) {
  let from = index
  while (from > 0 && !rawLines[from].includes('{')) from--
  let to = index
  while (to < rawLines.length - 1 && !rawLines[to].includes('}')) to++
  return rawLines.slice(from, to + 1).join('\n')
}

function checkLineHeight(value, rule) {
  const v = value.trim()
  if (LH_TOKENS.some((t) => new RegExp(`var\\(\\s*${t}\\s*\\)`).test(v))) return null
  if (/^(inherit|unset|initial|revert)$/.test(v)) return null

  const px = /^(-?\d*\.?\d+)px$/.exec(v)
  if (px && Number.isInteger(Number(px[1]))) return null
  const coefficient = /^(\d*\.?\d+)$/.exec(v)
  if (coefficient && Number.isInteger(Number(coefficient[1]))) return null

  const paired = /--fs-(xs|sm|md|lg|xl|2xl)\b/.exec(rule)
  const suggestion = paired ? `var(--lh-${paired[1]})` : 'var(--lh-md)'
  if (coefficient) {
    const px13 = Math.round(Number(coefficient[1]) * REM_BASE_PX * 100) / 100
    return (
      `hệ số không đơn vị nhân lại với font-size (= ${px13}px trên body 13px) → nửa pixel. ` +
      `Dùng \`${suggestion}\` (hoặc một px nguyên nếu font-size cũng là px cố định)`
    )
  }
  return `dùng \`${suggestion}\` hoặc một px nguyên thay vì \`${v}\``
}

// --- Rule 6: spacing parity ---------------------------------------------------------
// Padding / margin / gap on an ODD px hands the half pixel straight back to the centring
// maths that R4 and R5 just cleaned out: an odd inset inside an even box (or the reverse)
// puts the child on a .5 boundary again. The shell had 918 odd numbers across 2400+
// spacing declarations, in no rhythm at all (30 padding values, 19 gap values).
//
// This rule is deliberately WEAKER than "snap to a 4pt grid": forcing 9→12 moves three
// pixels and wraps content in places nobody can review, so the bar for now is only
// EVEN — every value within 1px of where it was. A real --sp-* scale is a later pass,
// once the surviving set of values is small enough to name.
//
// `±1px` is legal: a 1px inset is an optical nudge or hairline compensation, never
// rhythm, and both moves available to it (0 and 2) are wrong.
//
// Fractional px is out of scope on purpose — there is none in the repo, and rounding a
// fraction is a >1px move that belongs to a human. scripts/codemod-spacing.mjs holds the
// exact same predicate; keep them in step.
const SPACING_EXEMPT_PX = 1

function checkSpacing(value) {
  const odd = [...value.matchAll(/(-?\d+)px/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Math.abs(n) !== SPACING_EXEMPT_PX && Math.abs(n) % 2 === 1)
  if (!odd.length) return null
  const hint = value.trim().replace(/(-?\d+)px/g, (m, raw) => {
    const n = Number(raw)
    if (Math.abs(n) === SPACING_EXEMPT_PX || Math.abs(n) % 2 === 0) return m
    return `${Math.sign(n) * (Math.abs(n) - 1)}px`
  })
  return (
    `khoảng cách px lẻ (${odd.map((n) => `${n}px`).join(', ')}) → nửa pixel khi con căn giữa. ` +
    `Dùng \`${hint}\` (làm tròn XUỐNG số chẵn — chật thì an toàn với overflow). ` +
    'Nếu con số lẻ CHÍNH LÀ hình dạng: thêm `design-token-ok: <lý do>`'
  )
}

// --- Rule 5: icon scale -------------------------------------------------------------
// Scale declared next to --fs-* / --lh-* at assets/css/prototype.css: 12/14/16/20/24, all
// EVEN and fixed px (an icon is a glyph, not text — it must not scale with Appearance).
//
// An icon on an ODD px size lands on a half pixel the moment it is centred in a container
// of even height — `.icn` at 15px inside a 36px NavRail row sits at (36 - 15) / 2 = 10.5 —
// so its strokes never hit the device pixel grid and macOS paints them soft. Measured on
// the running app after P7a: 25 of the 28 odd-sized icons were on a half pixel.
//
// Legal: var(--icon-*) · any EVEN px (sizes outside the scale are fine, they just have to
// be even) · anything that is not a plain px length (`100%`, `auto`, `calc(...)`).
// scripts/lib/icon-sites.mjs decides WHERE an icon size is stated; this only judges it.
const ICON_CLASSES = learnIconClasses()

function checkIconSize(site) {
  if (ICON_TOKENS.some((t) => site.value.includes(t))) return null
  const px = /^(\d+)px$/.exec(site.value)
  if (!px) return null
  const n = Number(px[1])
  if (n === 0 || n > MAX_ICON_PX || n % 2 === 0) return null
  const target = iconTargetFor(n)
  const scale = ICON_SCALE.map((s) => s.px).join('/')
  return (
    `cỡ icon lẻ → nửa pixel khi căn giữa trong hộp cao chẵn ((36 - ${n}) / 2 = ${(36 - n) / 2}). ` +
    `Dùng \`${site.channel === 'size' ? target.replace(/\D/g, '') : target}\` (thang ${scale}, ` +
    'tất cả chẵn). Nếu con số lẻ CHÍNH LÀ hình dạng: thêm `design-token-ok: <lý do>`'
  )
}

const violations = { radius: [], type: [], mono: [], leading: [], icon: [], spacing: [] }
const legacyLeading = new Map()

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

        for (const [, prop, value] of line.matchAll(RE_SPACING)) {
          const hint = checkSpacing(value)
          if (hint) violations.spacing.push({ ...at, text: `${prop}: ${value.trim()}`, hint })
        }

        for (const [, prop, value] of line.matchAll(RE_LINE_HEIGHT)) {
          const hint = checkLineHeight(value, enclosingRule(rawLines, i))
          if (!hint) continue
          const found = (legacyLeading.get(relPath) ?? []).concat({
            ...at,
            text: `${prop}: ${value.trim()}`,
            hint,
          })
          legacyLeading.set(relPath, found)
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

    for (const site of iconSites(relPath, src, ICON_CLASSES)) {
      if (isMarked(rawLines, lines, site.line - 1, OPT_OUT)) continue
      const hint = checkIconSize(site)
      if (hint) {
        violations.icon.push({
          file: relPath,
          line: site.line,
          text: `${site.prop}: ${site.value}  [${site.context}]`,
          hint,
        })
      }
    }
  }
}

// Over-budget files report ALL of their sites: the allowance is a count, not a set of
// line numbers (those rot on the first edit), so the reviewer picks which ones to fix.
for (const [relPath, sites] of legacyLeading) {
  const allowance = LEGACY_COEFFICIENTS.get(relPath) ?? 0
  if (sites.length <= allowance) continue
  for (const site of sites) violations.leading.push(site)
  violations.leading.push({
    file: relPath,
    line: 0,
    text: `${sites.length} site trong file, hạn mức legacy là ${allowance}`,
    hint: 'hạ số site xuống bằng cách chuyển sang `var(--lh-*)` — KHÔNG nới hạn mức',
  })
}

const all = process.argv.includes('--all')
const CAP = 40

const RULES = [
  { key: 'radius', title: 'R1  border-radius không dùng token --r-*' },
  { key: 'type', title: 'R2  font-size dùng rem thay vì token --fs-*' },
  { key: 'mono', title: 'R3  var(--code) ngoài danh sách bề mặt code' },
  { key: 'leading', title: 'R4  line-height không dùng token --lh-* (hệ số lẻ / px lẻ)' },
  { key: 'icon', title: 'R5  cỡ icon lẻ — phải là token --icon-* hoặc px chẵn' },
  { key: 'spacing', title: 'R6  padding/margin/gap px lẻ — phải chẵn (±1px được giữ)' },
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
  const backlog = [...LEGACY_COEFFICIENTS.values()].reduce((a, b) => a + b, 0)
  process.stdout.write(
    'check-design-tokens: OK — không có vi phạm.\n' +
      `  R4 còn ${backlog} site legacy trong ${LEGACY_COEFFICIENTS.size} file (hệ số không đơn vị ` +
      'có trước khi có rule) — xem LEGACY_COEFFICIENTS, mỗi lần đi qua file nào thì dọn file đó.\n',
  )
  process.exit(0)
}

process.stdout.write(
  `\ncheck-design-tokens: ${total} vi phạm ` +
    `(radius ${violations.radius.length}, type ${violations.type.length}, ` +
    `mono ${violations.mono.length}, leading ${violations.leading.length}, ` +
    `icon ${violations.icon.length}, spacing ${violations.spacing.length}).\n` +
    'Xem docs/features/native-macos-polish.md §4 (W3/W4/W5/W9/W10) để biết bảng map token.\n',
)
process.exit(1)
