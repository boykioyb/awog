<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- Thanh cao cố định: hairline bằng inset shadow. -->
    <div
      class="flex h-9.5 flex-none items-center gap-2 px-3 shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      <span class="font-sans text-xs font-semibold text-muted-foreground">
        {{ t('git.commandLog.title') }}
      </span>
      <span class="text-xs text-faint tabular-nums">
        {{ t('git.commandLog.count', { n: rows.length }) }}
      </span>
      <span class="flex-1" />
      <label
        class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none"
      >
        <Checkbox :model-value="showReads" @update:model-value="(v) => (showReads = v === true)" />
        <span>{{ t('git.commandLog.showReads') }}</span>
      </label>
      <Button
        variant="outline"
        size="xs"
        :class="SEC_BTN"
        :disabled="!rows.length"
        @click="copyAll"
      >
        <Icon name="copy" />
        <span>{{ copied ? t('git.commandLog.copied') : t('git.commandLog.copy') }}</span>
      </Button>
      <Button
        variant="outline"
        size="xs"
        :class="SEC_BTN"
        :disabled="!total"
        @click="emit('clear')"
      >
        {{ t('git.commandLog.clear') }}
      </Button>
    </div>

    <div ref="scrollRef" class="flex-1 overflow-y-auto p-1.5">
      <p v-if="!rows.length" class="px-1.5 py-2.5 text-sm text-faint">
        {{ total ? t('git.commandLog.allFiltered') : t('git.commandLog.empty') }}
      </p>
      <div
        v-for="e in rows"
        :key="e.id"
        class="cursor-pointer rounded-sm px-2 py-1"
        :class="expanded.has(e.id) ? 'bg-muted' : 'hover:bg-accent'"
        @click="toggle(e)"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="flex-none text-xs text-faint tabular-nums">{{ clock(e.startedAt) }}</span>
          <!-- mono-ok: lệnh shell thật, người dùng có thể copy vào terminal -->
          <span
            class="min-w-0 flex-1 truncate font-mono text-sm"
            :class="e.exitCode !== 0 ? 'text-destructive' : 'text-foreground'"
          >
            git {{ e.argv.join(' ') }}
          </span>
          <span class="flex-none text-xs text-faint tabular-nums">{{ e.durationMs }}ms</span>
          <span
            class="min-w-5.5 flex-none text-right text-xs tabular-nums"
            :class="e.exitCode !== 0 ? 'font-semibold text-destructive' : 'text-faint'"
          >
            {{ e.exitCode }}
          </span>
        </div>
        <!-- Collapsed rows still show the failure reason: hiding the one line that
             says WHY would defeat the point of having a log. stderr FIRST, then
             stdout — `git merge` prints "CONFLICT (content): …" to stdout and
             leaves stderr empty, so keying on stderr alone left the most common
             failure in the app with a red exit code and no reason next to it. -->
        <!-- mono-ok: output git nguyên văn -->
        <pre
          v-if="!expanded.has(e.id) && e.exitCode !== 0 && reasonOf(e)"
          :class="[OUT, 'text-destructive']"
          >{{ reasonOf(e) }}</pre
        >
        <template v-if="expanded.has(e.id)">
          <!-- mono-ok: output git nguyên văn -->
          <pre v-if="e.stderr" :class="[OUT, 'text-destructive']">{{ e.stderr }}</pre>
          <!-- mono-ok: output git nguyên văn -->
          <pre v-if="e.stdout" :class="[OUT, 'text-muted-foreground']">{{ e.stdout }}</pre>
          <p v-if="!e.stdout && !e.stderr" class="px-1.5 py-2.5 text-sm text-faint">
            {{ t('git.commandLog.noOutput') }}
          </p>
          <p v-if="e.truncated" class="px-1.5 py-2.5 text-sm text-faint">
            {{ t('git.commandLog.truncated') }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The console every desktop git client has and AWOG did not: what `git …` the
// engine actually ran, its exit code, how long it took, and what it printed.
// Without it a failed op showed one mapped error string and the real command was
// only visible to a process the user cannot see.
//
// Entries arrive already redacted from the sidecar (a remote URL can carry
// `https://user:token@host`), so nothing here needs to re-filter — but nothing
// here may re-assemble raw values either.
import type { GitCommandEntry } from '~/composables/useGitApi'
import Button from '~/components/ui/button/Button.vue'
import Checkbox from '~/components/ui/checkbox/Checkbox.vue'
import { SEC_BTN } from './git-ui'

const props = defineProps<{ entries: GitCommandEntry[] }>()
const emit = defineEmits<{ (e: 'clear'): void }>()

const { t } = useI18n()
// Khối output git: thụt theo cột thời gian, wrap, cuộn ngang nếu cần.
const OUT =
  'mt-1 ml-16.5 overflow-x-auto rounded-sm bg-muted px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap'

// Reads are the majority by far — the watcher re-runs `status` on every file
// change — so they are hidden by default or they bury the command being chased.
const showReads = ref(false)
const expanded = ref<Set<number>>(new Set())
const copied = ref(false)
const scrollRef = useTemplateRef<HTMLElement>('scrollRef')

const total = computed(() => props.entries.length)
const rows = computed(() =>
  showReads.value ? props.entries : props.entries.filter((e) => !e.readOnly),
)

function toggle(e: GitCommandEntry) {
  const next = new Set(expanded.value)
  if (next.has(e.id)) next.delete(e.id)
  else next.add(e.id)
  expanded.value = next
}

const clock = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// The one line worth showing next to a non-zero exit, from whichever stream git
// chose to put it on.
const reasonOf = (e: GitCommandEntry) => {
  const src = e.stderr.trim() || e.stdout.trim()
  if (!src) return ''
  const lines = src.split('\n').filter(Boolean)
  // Prefer a line that names the problem over git's first progress line
  // ("Auto-merging f.txt" comes before "CONFLICT (content): …").
  return lines.find((l) => /conflict|error|fatal|denied|refus|reject/i.test(l)) ?? lines[0] ?? ''
}

async function copyAll() {
  const text = rows.value
    .map((e) => `git ${e.argv.join(' ')}  → ${e.exitCode} (${e.durationMs}ms)`)
    .join('\n')
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// Follow the tail, but only when the user is already at the bottom — yanking the
// view down while they are reading an older failure is worse than not following.
watch(
  () => props.entries.length,
  async () => {
    const el = scrollRef.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!atBottom) return
    await nextTick()
    el.scrollTop = el.scrollHeight
  },
)
</script>
