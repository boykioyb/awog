<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-h-[88vh] grid-rows-[auto_1fr_auto] sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon name="sparkles" class="size-4 shrink-0 text-primary" />
          {{ t('git.prSummary.title') }}
        </DialogTitle>
      </DialogHeader>

      <div class="grid min-h-0 gap-3 overflow-y-auto pr-1">
        <!-- Compare row: head → base picker -->
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-0.5 font-mono text-xs"
          >
            <Icon name="branch" class="size-3" />
            {{ head }}
          </span>
          <Icon name="fork" class="size-3.5 text-muted-foreground" />
          <span class="text-sm text-muted-foreground">{{ t('git.prSummary.into') }}</span>
          <AppSelect
            v-if="baseOptions.length"
            :model-value="base"
            :options="baseOptions"
            width="200px"
            :disabled="loading"
            @update:model-value="onBaseChange"
          />
          <span v-else class="text-sm italic text-muted-foreground">
            {{ t('git.prSummary.noBase') }}
          </span>
        </div>

        <!-- Rule row: which commit-rule file governs the title + Generate action -->
        <div class="flex flex-wrap items-center gap-2">
          <Icon name="rules" class="size-3.5 text-muted-foreground" />
          <span class="text-sm text-muted-foreground">{{ t('git.prSummary.ruleLabel') }}</span>
          <AppSelect
            :model-value="rulePath"
            :options="ruleOptions"
            width="240px"
            :disabled="loading"
            @update:model-value="onRuleChange"
          />
          <span class="flex-1" />
          <Button size="sm" :disabled="loading || !base || !head" @click="runGenerate">
            <span class="relative inline-flex size-3.5 items-center justify-center">
              <Icon name="sparkles" class="size-3.5" />
              <span
                v-if="loading"
                class="absolute -inset-[3px] animate-spin rounded-full border border-transparent border-t-primary-foreground"
              />
            </span>
            {{ generated ? t('git.prSummary.regenerate') : t('git.prSummary.generate') }}
          </Button>
        </div>

        <!-- Error banner -->
        <div
          v-if="error"
          class="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
        >
          <Icon name="alert" class="size-3.5 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="flex items-center justify-center gap-2.5 py-10 text-sm text-muted-foreground"
        >
          <span class="relative inline-flex size-4 items-center justify-center">
            <Icon name="sparkles" class="size-4" />
            <span
              class="absolute -inset-[3px] animate-spin rounded-full border border-transparent border-t-primary"
            />
          </span>
          <span>{{ t('git.prSummary.generating') }}</span>
        </div>

        <!-- Empty state (before the first generation) -->
        <div
          v-else-if="!generated"
          class="flex min-h-[200px] flex-col items-center justify-center gap-2.5 py-10 text-center text-sm text-muted-foreground"
        >
          <Icon name="sparkles" class="size-5 text-muted-foreground" />
          <span>{{ t('git.prSummary.emptyHint') }}</span>
        </div>

        <template v-else>
          <!-- Title field -->
          <div class="grid gap-1.5">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-muted-foreground">
                {{ t('git.prSummary.titleLabel') }}
              </span>
              <Button
                variant="outline"
                size="xs"
                class="ml-auto"
                :title="t('common.copy')"
                @click="copy(title, 'title')"
              >
                <Icon :name="copied === 'title' ? 'check' : 'copy'" class="size-3" />
                {{ copied === 'title' ? t('common.copied') : t('common.copy') }}
              </Button>
            </div>
            <Input v-model="title" :placeholder="t('git.prSummary.titleLabel')" />
          </div>

          <!-- Description editor (Write / Preview) -->
          <div class="grid min-h-0 gap-1.5">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-muted-foreground">
                {{ t('git.prSummary.descLabel') }}
              </span>
              <!-- segmented Write/Preview — shadcn tabs-list shape -->
              <div
                class="inline-flex h-[var(--ctrl-h-xs)] items-center gap-0.5 rounded-md bg-muted p-0.5"
              >
                <Button
                  variant="ghost"
                  type="button"
                  class="h-auto p-0 rounded-sm px-2.5 text-xs font-medium transition-colors"
                  :class="
                    mode === 'write'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="mode = 'write'"
                >
                  {{ t('git.prSummary.write') }}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  class="h-auto p-0 rounded-sm px-2.5 text-xs font-medium transition-colors"
                  :class="
                    mode === 'preview'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="mode = 'preview'"
                >
                  {{ t('git.prSummary.preview') }}
                </Button>
              </div>
              <span class="flex-1" />
              <div v-if="mode === 'write'" class="inline-flex gap-0.5">
                <Button
                  v-for="tool in TOOLS"
                  :key="tool.k"
                  variant="ghost"
                  size="iconSm"
                  :title="tool.k"
                  :aria-label="tool.k"
                  @click="tool.run()"
                >
                  <Icon :name="tool.icon" class="size-3" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="xs"
                :title="t('common.copy')"
                @click="copy(description, 'desc')"
              >
                <Icon :name="copied === 'desc' ? 'check' : 'copy'" class="size-3" />
                {{ copied === 'desc' ? t('common.copied') : t('common.copy') }}
              </Button>
            </div>

            <!-- Bounded height (not flex-fill) so the modal never grows past the
                 viewport — the box scrolls internally; resize:none keeps the Write
                 box the same footprint as Preview (no shift on toggle). -->
            <Textarea
              v-show="mode === 'write'"
              ref="ta"
              v-model="description"
              class="max-h-[42vh] min-h-[200px] resize-none font-mono"
              :placeholder="t('git.prSummary.descLabel')"
            />
            <div
              v-if="mode === 'preview'"
              class="max-h-[42vh] min-h-[200px] overflow-y-auto rounded-md border border-input px-3 py-2.5 text-sm"
            >
              <ProjectGhMarkdown v-if="description.trim()" :source="description" />
              <div v-else class="italic text-muted-foreground">
                {{ t('git.prSummary.previewEmpty') }}
              </div>
            </div>
          </div>
        </template>
      </div>

      <DialogFooter class="items-center">
        <span v-if="truncated" class="mr-auto text-xs text-muted-foreground">
          {{ t('git.prSummary.truncated') }}
        </span>
        <Button variant="outline" @click="emit('close')">{{ t('common.close') }}</Button>
        <Button :disabled="loading || !title.trim() || !description.trim()" @click="copyAll">
          <Icon :name="copied === 'all' ? 'check' : 'copy'" class="size-3.5" />
          {{ copied === 'all' ? t('common.copied') : t('git.prSummary.copyAll') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
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
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
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
const ta = useTemplateRef<{ $el?: HTMLTextAreaElement } | HTMLTextAreaElement>('ta')

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
const taEl = () => (ta.value instanceof HTMLTextAreaElement ? ta.value : (ta.value?.$el ?? null))

function applyEdit(next: string, selStart: number, selEnd: number) {
  description.value = next
  void nextTick(() => {
    const el = taEl()
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}
function surround(before: string, after: string) {
  const el = taEl()
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
  const el = taEl()
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
