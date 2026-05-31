<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="!detail"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      Select a commit
    </div>
    <template v-else>
      <div
        class="px-4 py-3 flex-shrink-0 max-h-[50vh] overflow-y-auto"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-mono" :style="{ color: t.accent }">
            {{ detail.commit.shortHash }}
          </span>
          <span
            v-if="linkedPhaseId"
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.infoBg,
              color: t.info,
              border: `1px solid ${t.infoBorder}`,
            }"
          >
            <Link :size="9" class="inline-block mr-0.5" />
            phase {{ linkedPhaseId }}
          </span>
          <button
            v-if="linkedPhaseId && linkedTaskId"
            type="button"
            class="text-[0.71em] px-1.5 py-0.5 rounded transition inline-flex items-center gap-1"
            :style="{
              background: 'transparent',
              color: t.accent,
              border: `1px solid ${t.border}`,
            }"
            :title="
              tr('git.commit_detail.open_in_task', {
                task: linkedTaskId ?? '',
                phase: linkedPhaseId ?? '',
              })
            "
            @click="onOpenInTask"
          >
            <ExternalLink :size="9" />
            Open in task
          </button>
          <span
            v-else-if="linkedPhaseId"
            class="text-[0.71em] px-1.5 py-0.5 rounded"
            :style="{ color: t.textFaint, border: `1px solid ${t.border}` }"
            :title="tr('git.commit_detail.task_not_found')"
          >
            task not found
          </span>
        </div>
        <div class="text-sm" :style="{ color: t.text }">{{ detail.commit.subject }}</div>
        <div
          v-if="detail.commit.body"
          class="text-xs mt-2 whitespace-pre-wrap"
          :style="{ color: t.textMuted }"
        >
          {{ detail.commit.body }}
        </div>
        <div class="flex items-center gap-2 text-[0.71em] mt-2" :style="{ color: t.textDim }">
          <span>{{ detail.commit.authorName }}</span>
          <span>&lt;{{ detail.commit.authorEmail }}&gt;</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span>{{ new Date(detail.commit.date).toLocaleString() }}</span>
        </div>
      </div>

      <div
        class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="text-[0.71em] uppercase tracking-wider" :style="{ color: t.textDim }">
          Files ({{ detail.files.length }})
        </div>
      </div>
      <div class="flex flex-col flex-1 overflow-hidden">
        <div
          class="flex flex-wrap gap-1 px-3 py-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div
            v-for="(f, i) in detail.files"
            :key="f.path"
            class="flex items-center gap-0.5 rounded"
            :style="{
              background: activeFileIndex === i ? t.bgActive : t.bgInput,
              border: `1px solid ${t.border}`,
            }"
          >
            <button
              type="button"
              class="text-[0.71em] font-mono px-2 py-1 transition truncate max-w-full"
              :style="{ color: activeFileIndex === i ? t.text : t.textMuted }"
              @click="activeFileIndex = i"
            >
              {{ f.path }}
            </button>
            <button
              type="button"
              class="p-1 rounded transition"
              :style="{ color: t.textDim }"
              :title="tr('git.commit_detail.revert_file_title', { path: f.path })"
              @click="onRevertFile(f.path)"
            >
              <Undo2 :size="11" />
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <GitDiffViewer :diff="detail.files[activeFileIndex] ?? null" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ExternalLink, Link, Undo2 } from 'lucide-vue-next'
import type { GitCommit, GitFileDiff } from '~/types'

const props = defineProps<{
  detail: { commit: GitCommit; files: GitFileDiff[] } | null
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()
const workspace = useWorkspaceStore()
const activeFileIndex = ref(0)

// Parse `[<phaseId>] …` from the commit subject (AC-39). Falls back to the
// `phaseId` already adapted onto the commit by the sidecar when present.
const COMMIT_PHASE_RE = /^\[([^\]]+)\]/
const linkedPhaseId = computed<string | null>(() => {
  const commit = props.detail?.commit
  if (!commit) return null
  if (commit.phaseId) return commit.phaseId
  const match = COMMIT_PHASE_RE.exec(commit.subject)
  return match?.[1] ?? null
})

// Resolve the task id by scanning the workspace store. Tasks store phases as
// a `Record<string, Phase>` keyed by node id; we match against that key.
const linkedTaskId = computed<string | null>(() => {
  const phaseId = linkedPhaseId.value
  if (!phaseId) return null
  const task = workspace.tasks.find((tk) =>
    Object.prototype.hasOwnProperty.call(tk.phases, phaseId),
  )
  return task?.id ?? null
})

const onOpenInTask = () => {
  const taskId = linkedTaskId.value
  const phaseId = linkedPhaseId.value
  if (!taskId || !phaseId) return
  navigateTo(`/tasks/${taskId}#phase=${phaseId}`)
}

// Per-file revert (AC Flow 6): checkout the file at <commit>^ so the working
// tree mirrors the state immediately before this commit. `window.confirm` is
// the v1 confirm primitive — a dedicated modal can replace later without
// changing the wiring (TODO M6 polish).
const onRevertFile = async (path: string) => {
  const commit = props.detail?.commit
  if (!commit) return
  const ref = `${commit.hash}^`
  // eslint-disable-next-line no-alert -- simple confirm for v1; replace with modal in M6
  if (!window.confirm(tr('git.commit_detail.revert_file_confirm', { path, sha: commit.shortHash })))
    return
  await store.checkoutFileAtCommit(path, ref)
}
</script>
