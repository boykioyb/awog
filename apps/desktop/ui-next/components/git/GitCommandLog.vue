<template>
  <div class="gclog">
    <div class="gclhd">
      <span class="gchtitle">{{ t('git.commandLog.title') }}</span>
      <span class="gclct">{{ t('git.commandLog.count', { n: rows.length }) }}</span>
      <span style="flex: 1" />
      <label class="gcltoggle">
        <input v-model="showReads" type="checkbox" />
        <span>{{ t('git.commandLog.showReads') }}</span>
      </label>
      <button class="gsecbtn" :disabled="!rows.length" @click="copyAll">
        <Icon name="copy" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span>{{ copied ? t('git.commandLog.copied') : t('git.commandLog.copy') }}</span>
      </button>
      <button class="gsecbtn" :disabled="!total" @click="emit('clear')">
        {{ t('git.commandLog.clear') }}
      </button>
    </div>

    <div ref="scrollRef" class="gclbody">
      <p v-if="!rows.length" class="gclempty">
        {{ total ? t('git.commandLog.allFiltered') : t('git.commandLog.empty') }}
      </p>
      <div
        v-for="e in rows"
        :key="e.id"
        class="gclrow"
        :class="{ fail: e.exitCode !== 0, open: expanded.has(e.id) }"
        @click="toggle(e)"
      >
        <div class="gclline">
          <span class="gcltime tnum">{{ clock(e.startedAt) }}</span>
          <span class="gclcmd mono">git {{ e.argv.join(' ') }}</span>
          <span class="gcldur tnum">{{ e.durationMs }}ms</span>
          <span class="gclcode tnum" :class="{ fail: e.exitCode !== 0 }">{{ e.exitCode }}</span>
        </div>
        <!-- Collapsed rows still show the failure reason: hiding the one line that
             says WHY would defeat the point of having a log. stderr FIRST, then
             stdout — `git merge` prints "CONFLICT (content): …" to stdout and
             leaves stderr empty, so keying on stderr alone left the most common
             failure in the app with a red exit code and no reason next to it. -->
        <pre v-if="!expanded.has(e.id) && e.exitCode !== 0 && reasonOf(e)" class="gclerr mono">{{
          reasonOf(e)
        }}</pre>
        <template v-if="expanded.has(e.id)">
          <pre v-if="e.stderr" class="gclout mono err">{{ e.stderr }}</pre>
          <pre v-if="e.stdout" class="gclout mono">{{ e.stdout }}</pre>
          <p v-if="!e.stdout && !e.stderr" class="gclnoout">{{ t('git.commandLog.noOutput') }}</p>
          <p v-if="e.truncated" class="gclnoout">{{ t('git.commandLog.truncated') }}</p>
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

const props = defineProps<{ entries: GitCommandEntry[] }>()
const emit = defineEmits<{ (e: 'clear'): void }>()

const { t } = useI18n()

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

<style scoped>
.gclog {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.gclhd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  height: 38px;
  padding: 0 12px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.gclct {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
}
.gcltoggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  cursor: pointer;
  user-select: none;
}
.gclbody {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.gclempty,
.gclnoout {
  padding: 10px 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.gclrow {
  padding: 5px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.gclrow:hover {
  background: var(--bgHover);
}
.gclrow.open {
  background: var(--bgSubtle);
}
.gclline {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.gcltime {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* mono-ok: an actual shell command the user may copy into a terminal */
.gclcmd {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.gclrow.fail .gclcmd {
  color: var(--danger);
}
.gcldur {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.gclcode {
  flex: 0 0 auto;
  min-width: 22px;
  text-align: right;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.gclcode.fail {
  color: var(--danger);
  font-weight: 600;
}
/* mono-ok: raw git output */
.gclerr,
.gclout {
  margin: 4px 0 0 66px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  background: var(--bgInput);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
.gclerr,
.gclout.err {
  color: var(--danger);
}
</style>
