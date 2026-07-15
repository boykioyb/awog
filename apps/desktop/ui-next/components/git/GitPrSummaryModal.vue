<template>
  <Teleport to="body">
    <div v-if="open" class="prm-ovl" @click.self="emit('close')">
      <div class="prm-card" role="dialog" aria-modal="true">
        <!-- Header -->
        <div class="prm-head">
          <div class="prm-headmain">
            <Icon name="sparkles" style="width: 15px; height: 15px; color: var(--accent)" />
            <span class="prm-title">{{ t('git.prSummary.title') }}</span>
          </div>
          <button class="prm-x" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <!-- Compare row: head → base picker -->
        <div class="prm-compare">
          <span class="prm-branch">
            <Icon name="branch" style="width: 12px; height: 12px" />
            {{ head }}
          </span>
          <Icon name="fork" style="width: 13px; height: 13px; color: var(--textDim)" />
          <span class="prm-into">{{ t('git.prSummary.into') }}</span>
          <AppSelect
            v-if="baseOptions.length"
            :model-value="base"
            :options="baseOptions"
            width="200px"
            :disabled="loading"
            @update:model-value="onBaseChange"
          />
          <span v-else class="prm-nobase">{{ t('git.prSummary.noBase') }}</span>
        </div>

        <!-- Rule row: which commit-rule file governs the title + Generate action -->
        <div class="prm-rulerow">
          <Icon name="rules" style="width: 13px; height: 13px; color: var(--textDim)" />
          <span class="prm-into">{{ t('git.prSummary.ruleLabel') }}</span>
          <AppSelect
            :model-value="rulePath"
            :options="ruleOptions"
            width="240px"
            :disabled="loading"
            @update:model-value="onRuleChange"
          />
          <span style="flex: 1" />
          <button
            class="btn pri sm"
            type="button"
            :disabled="loading || !base || !head"
            @click="runGenerate"
          >
            <Icon name="sparkles" :class="{ prmspin: loading }" style="width: 13px; height: 13px" />
            {{ generated ? t('git.prSummary.regenerate') : t('git.prSummary.generate') }}
          </button>
        </div>

        <!-- Error banner -->
        <div v-if="error" class="prm-err">
          <Icon name="alert" style="width: 13px; height: 13px" />
          <span>{{ error }}</span>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="prm-loading">
          <Icon name="sparkles" class="prmspin" style="width: 16px; height: 16px" />
          <span>{{ t('git.prSummary.generating') }}</span>
        </div>

        <!-- Empty state (before the first generation) -->
        <div v-else-if="!generated" class="prm-placeholder">
          <Icon name="sparkles" style="width: 22px; height: 22px; color: var(--textDim)" />
          <span>{{ t('git.prSummary.emptyHint') }}</span>
        </div>

        <template v-else>
          <!-- Title field -->
          <div class="prm-field">
            <div class="prm-fieldhd">
              <span class="prm-label">{{ t('git.prSummary.titleLabel') }}</span>
              <button
                class="prm-copy"
                type="button"
                :title="t('common.copy')"
                @click="copy(title, 'title')"
              >
                <Icon
                  :name="copied === 'title' ? 'check' : 'copy'"
                  style="width: 12px; height: 12px"
                />
                {{ copied === 'title' ? t('common.copied') : t('common.copy') }}
              </button>
            </div>
            <input v-model="title" class="prm-input" :placeholder="t('git.prSummary.titleLabel')" />
          </div>

          <!-- Description editor (Write / Preview) -->
          <div class="prm-field prm-descfield">
            <div class="prm-fieldhd">
              <span class="prm-label">{{ t('git.prSummary.descLabel') }}</span>
              <div class="prm-seg">
                <button
                  class="prm-segbtn"
                  :class="{ on: mode === 'write' }"
                  type="button"
                  @click="mode = 'write'"
                >
                  {{ t('git.prSummary.write') }}
                </button>
                <button
                  class="prm-segbtn"
                  :class="{ on: mode === 'preview' }"
                  type="button"
                  @click="mode = 'preview'"
                >
                  {{ t('git.prSummary.preview') }}
                </button>
              </div>
              <span style="flex: 1" />
              <div v-if="mode === 'write'" class="prm-tools">
                <button
                  v-for="tool in TOOLS"
                  :key="tool.k"
                  class="prm-tool"
                  type="button"
                  :title="tool.k"
                  @click="tool.run()"
                >
                  <Icon :name="tool.icon" style="width: 12px; height: 12px" />
                </button>
              </div>
              <button
                class="prm-copy"
                type="button"
                :title="t('common.copy')"
                @click="copy(description, 'desc')"
              >
                <Icon
                  :name="copied === 'desc' ? 'check' : 'copy'"
                  style="width: 12px; height: 12px"
                />
                {{ copied === 'desc' ? t('common.copied') : t('common.copy') }}
              </button>
            </div>

            <textarea
              v-show="mode === 'write'"
              ref="ta"
              v-model="description"
              class="prm-textarea"
              :placeholder="t('git.prSummary.descLabel')"
            />
            <div v-if="mode === 'preview'" class="prm-preview">
              <ProjectGhMarkdown v-if="description.trim()" :source="description" />
              <div v-else class="prm-empty">{{ t('git.prSummary.previewEmpty') }}</div>
            </div>
          </div>
        </template>

        <!-- Footer -->
        <div class="prm-foot">
          <span v-if="truncated" class="prm-hint">{{ t('git.prSummary.truncated') }}</span>
          <span style="flex: 1" />
          <button class="btn" type="button" @click="emit('close')">{{ t('common.close') }}</button>
          <button
            class="btn pri"
            type="button"
            :disabled="loading || !title.trim() || !description.trim()"
            @click="copyAll"
          >
            <Icon :name="copied === 'all' ? 'check' : 'copy'" style="width: 13px; height: 13px" />
            {{ copied === 'all' ? t('common.copied') : t('git.prSummary.copyAll') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// PR summary modal — generates a pull-request title + markdown description for a
// branch (`head`) against a chosen base, following a chosen commit-rule file, then
// lets the user edit, preview (rendered markdown), and copy. Generation is manual
// (the user picks base + rule, then clicks Generate — no auto-run, which keeps
// model calls off every open) and delegated via the `generate` prop (the git
// store's generatePrSummary) so this component stays free of IPC. The base branch
// and rule-file choice are remembered per project (useGitPrPrefs).
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import ProjectGhMarkdown from '~/components/project/ProjectGhMarkdown.vue'
import type { BranchInfo } from './git-types'
import type { PrSummaryResult } from '~/composables/useGitApi'

const props = defineProps<{
  open: boolean
  head: string
  branches: BranchInfo[]
  currentBranch: string
  // Scopes the remembered base branch + rule file (per project) — see useGitPrPrefs.
  projectId: string
  // Lists the project's candidate commit-rule files (workspace-relative paths).
  ruleFiles: () => Promise<string[]>
  generate: (head: string, base: string, opts?: { rulePath?: string }) => Promise<PrSummaryResult>
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()

// Remembers the last base + rule-file the user picked, per project.
const prefs = useGitPrPrefs(() => props.projectId)

const base = ref('')
// '' = the "Default (app setting)" rule option; otherwise a workspace-relative path.
const rulePath = ref('')
const ruleFilesList = ref<string[]>([])
const title = ref('')
const description = ref('')
const mode = ref<'write' | 'preview'>('write')
const loading = ref(false)
// True once a generation has produced content (drives the empty-state → editor swap).
const generated = ref(false)
const error = ref<string | null>(null)
const truncated = ref(false)
const copied = ref<'title' | 'desc' | 'all' | null>(null)
const ta = useTemplateRef<HTMLTextAreaElement>('ta')

// Common merge targets, most-preferred first — used to pick a sensible default base.
const DEFAULT_BASES = ['main', 'master', 'develop', 'trunk']

// Every branch except the head itself is a valid base. Local branches first, then
// remote-tracking refs (both are things `git diff base...head` accepts).
const baseOptions = computed<AppSelectOption[]>(() => {
  const locals = props.branches
    .filter((b) => !b.remote && b.name !== props.head)
    .map((b) => ({ label: b.name, value: b.name }))
  const remotes = props.branches
    .filter((b) => b.remote && b.name !== props.head)
    .map((b) => ({ label: b.name, value: b.name }))
  return [...locals, ...remotes]
})

// The "Default (app rule)" option plus every discovered rule file.
const ruleOptions = computed<AppSelectOption[]>(() => [
  { label: t('git.prSummary.ruleDefault'), value: '' },
  ...ruleFilesList.value.map((p) => ({ label: p, value: p })),
])

function pickDefaultBase(): string {
  const opts = baseOptions.value
  const has = (name: string) => opts.some((o) => o.value === name)
  const remembered = prefs.getBase()
  if (remembered && has(remembered)) return remembered
  for (const cand of DEFAULT_BASES) if (has(cand)) return cand
  if (props.currentBranch !== props.head && has(props.currentBranch)) return props.currentBranch
  return opts[0]?.value ?? ''
}

// The remembered rule wins (incl. an explicit '' = Default) when still valid; else
// the first discovered file (git-commit.md is sorted first), else Default.
function pickDefaultRule(): string {
  const remembered = prefs.getRulePath()
  if (remembered === '' || (remembered && ruleFilesList.value.includes(remembered))) {
    return remembered
  }
  return ruleFilesList.value[0] ?? ''
}

// A token that invalidates in-flight generations when a newer request starts — so
// a slow response never clobbers a newer one's result.
let runToken = 0

async function runGenerate() {
  if (!base.value) return
  const token = ++runToken
  loading.value = true
  error.value = null
  try {
    const res = await props.generate(props.head, base.value, {
      rulePath: rulePath.value || undefined,
    })
    if (token !== runToken) return
    title.value = res.title
    description.value = res.description
    truncated.value = res.truncated
    generated.value = true
    mode.value = 'write'
  } catch (err) {
    if (token !== runToken) return
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (token === runToken) loading.value = false
  }
}

function onBaseChange(next: string) {
  if (next === base.value) return
  base.value = next
  prefs.rememberBase(next)
}

function onRuleChange(next: string) {
  if (next === rulePath.value) return
  rulePath.value = next
  prefs.rememberRulePath(next)
}

// Reset + load rule files whenever the modal opens. Pre-fills base + rule from the
// remembered choices; does NOT auto-generate (the user clicks Generate).
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    title.value = ''
    description.value = ''
    error.value = null
    truncated.value = false
    copied.value = null
    generated.value = false
    mode.value = 'write'
    base.value = pickDefaultBase()
    ruleFilesList.value = []
    try {
      ruleFilesList.value = await props.ruleFiles()
    } catch {
      ruleFilesList.value = []
    }
    rulePath.value = pickDefaultRule()
  },
)

function copy(text: string, which: 'title' | 'desc' | 'all') {
  void navigator.clipboard?.writeText(text).catch(() => {})
  copied.value = which
  window.setTimeout(() => {
    if (copied.value === which) copied.value = null
  }, 1500)
}

function copyAll() {
  copy(`${title.value}\n\n${description.value}`, 'all')
}

// ── Markdown insert helpers (mirror ProjectGhComposer) ──
function applyEdit(next: string, selStart: number, selEnd: number) {
  description.value = next
  void nextTick(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}
function surround(before: string, after: string) {
  const el = ta.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const v = el.value
  const sel = v.slice(s, e)
  applyEdit(
    v.slice(0, s) + before + sel + after + v.slice(e),
    s + before.length,
    s + before.length + sel.length,
  )
}
function prefixLines(prefix: string) {
  const el = ta.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const v = el.value
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  const block = v.slice(lineStart, e) || ''
  const replaced = block
    .split('\n')
    .map((l) => prefix + l)
    .join('\n')
  applyEdit(v.slice(0, lineStart) + replaced + v.slice(e), lineStart, lineStart + replaced.length)
}
const TOOLS: { k: string; icon: string; run: () => void }[] = [
  { k: 'bold', icon: 'bold', run: () => surround('**', '**') },
  { k: 'italic', icon: 'italic', run: () => surround('_', '_') },
  { k: 'code', icon: 'code', run: () => surround('`', '`') },
  { k: 'list', icon: 'listul', run: () => prefixLines('- ') },
  { k: 'quote', icon: 'quote', run: () => prefixLines('> ') },
]
</script>

<style scoped>
.prm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 24px;
}
.prm-card {
  width: 720px;
  max-width: 94vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.prm-head {
  display: flex;
  align-items: center;
}
.prm-headmain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.prm-title {
  font-size: 1.08em;
  font-weight: 600;
  color: var(--text);
}
.prm-x {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.prm-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.prm-compare,
.prm-rulerow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.prm-branch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--code);
  font-size: 12px;
}
.prm-into {
  font-size: 1em;
  color: var(--textDim);
}
.prm-nobase {
  font-size: 1em;
  color: var(--textDim);
  font-style: italic;
}
.prm-err {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dangerBg);
  border: 1px solid var(--dangerBorder);
  color: var(--danger);
  font-size: 1em;
}
.prm-loading,
.prm-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 200px;
  padding: 40px 0;
  color: var(--textDim);
  font-size: 1em;
  text-align: center;
}
.prm-loading {
  flex-direction: row;
  min-height: 0;
  padding: 40px 0;
}
.prm-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.prm-descfield {
  min-height: 0;
}
.prm-fieldhd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prm-label {
  font-size: 1em;
  font-weight: 600;
  color: var(--textDim);
}
.prm-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-size: 12px;
}
.prm-copy:hover {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.prm-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.prm-input:focus {
  border-color: var(--accent);
}
.prm-seg {
  display: inline-flex;
  gap: 2px;
}
.prm-segbtn {
  font-size: 1em;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.prm-segbtn:hover {
  color: var(--text);
}
.prm-segbtn.on {
  color: var(--accent);
  background: var(--accentDim);
  border-color: var(--accentBorder);
  font-weight: 600;
}
.prm-tools {
  display: inline-flex;
  gap: 2px;
}
.prm-tool {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.prm-tool:hover {
  color: var(--text);
  border-color: var(--border);
}
.prm-textarea {
  width: 100%;
  /* Bounded height (not flex-fill) so the modal never grows past the viewport /
     the host Git modal — the box scrolls internally instead. resize:none keeps the
     Write box the same footprint as the Preview box (no shift on toggle). */
  min-height: 200px;
  max-height: 42vh;
  resize: none;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  color: var(--text);
  font-family: var(--code);
  font-size: 1em;
  line-height: 1.55;
}
.prm-textarea:focus {
  border-color: var(--accent);
}
.prm-preview {
  min-height: 200px;
  max-height: 42vh;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1em;
  line-height: 1.6;
}
.prm-empty {
  color: var(--textDim);
  font-style: italic;
}
.prm-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.prm-hint {
  font-size: 12px;
  color: var(--textDim);
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.prmspin {
  animation: prmspin 0.9s linear infinite;
}
@keyframes prmspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .prmspin {
    animation: none;
  }
}
</style>
