<template>
  <div class="flex flex-col h-full min-h-0" :style="{ background: t.bgPanel }">
    <div
      class="flex items-center justify-between px-3 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <span class="text-[1em] uppercase tracking-wide font-medium" :style="{ color: t.textDim }">
        Source Control
      </span>
      <div class="flex items-center gap-0.5">
        <button type="button" :title="'Refresh'" :style="iconBtn" @click="load">
          <RefreshCw :size="13" />
        </button>
        <button type="button" :title="'Open Git Manager'" :style="iconBtn" @click="openGitManager">
          <ExternalLink :size="13" />
        </button>
      </div>
    </div>

    <!-- Branch -->
    <div
      v-if="status?.branch"
      class="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 text-[1em]"
      :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
    >
      <GitBranch :size="13" />
      <span class="truncate">{{ status.branch }}</span>
      <span v-if="status.ahead" class="text-[12px] font-mono" :style="{ color: t.gitAdded }">
        ↑{{ status.ahead }}
      </span>
      <span v-if="status.behind" class="text-[12px] font-mono" :style="{ color: t.gitModified }">
        ↓{{ status.behind }}
      </span>
    </div>

    <!-- Commit box -->
    <div class="px-3 py-2 flex flex-col gap-2 flex-shrink-0">
      <textarea
        v-model="message"
        rows="2"
        placeholder="Commit message…"
        class="w-full px-2 py-1.5 rounded text-[1em] outline-none resize-y min-h-[3rem]"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
      />
      <button
        type="button"
        class="px-2 py-1.5 rounded text-[1em] flex items-center justify-center gap-1.5"
        :style="{
          background: canCommit ? t.accent : t.bgHover,
          color: canCommit ? t.accentText : t.textFaint,
        }"
        :disabled="!canCommit"
        @click="doCommit"
      >
        <Check :size="13" />
        Commit {{ stagedCount ? `(${stagedCount})` : '' }}
      </button>
    </div>

    <!-- File lists -->
    <div class="flex-1 min-h-0 overflow-auto">
      <p
        v-if="!status?.branch && !loading"
        class="px-3 py-2 text-[1em]"
        :style="{ color: t.textFaint }"
      >
        Not a git repository
      </p>
      <CodeScmSection
        v-if="staged.length"
        label="Staged Changes"
        :files="staged"
        action="unstage"
        @open="(p) => ctx.openFile(p)"
        @action="(p) => unstage(p)"
      />
      <CodeScmSection
        v-if="unstaged.length"
        label="Changes"
        :files="unstaged"
        action="stage"
        @open="(p) => ctx.openFile(p)"
        @action="(p) => stage(p)"
      />
      <p
        v-if="status?.branch && staged.length === 0 && unstaged.length === 0 && !loading"
        class="px-3 py-2 text-[1em]"
        :style="{ color: t.textFaint }"
      >
        No changes
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, ExternalLink, GitBranch, RefreshCw } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CSSProperties } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  useGitApi,
  type SidecarGitFileStatus,
  type SidecarGitStatus,
} from '~/composables/useGitApi'
import { useSidecar } from '~/composables/useSidecar'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'
import CodeScmSection from './CodeScmSection.vue'

const { t } = useTheme()
const ctx = useProjectWorkspaceContext()
const git = useGitApi()
const sidecar = useSidecar()

const status = ref<SidecarGitStatus | null>(null)
const loading = ref(false)
const message = ref('')
let unlisten: UnlistenFn | null = null

const iconBtn = computed<CSSProperties>(() => ({
  padding: '6px',
  borderRadius: '4px',
  color: t.value.textDim,
  transition: 'all 0.15s',
}))

const isStaged = (f: SidecarGitFileStatus) => f.stageState === 'staged'
const staged = computed<SidecarGitFileStatus[]>(() => (status.value?.files ?? []).filter(isStaged))
const unstaged = computed<SidecarGitFileStatus[]>(() =>
  (status.value?.files ?? []).filter((f) => !isStaged(f)),
)
const stagedCount = computed(() => staged.value.length)
const canCommit = computed(() => stagedCount.value > 0 && message.value.trim().length > 0)

const load = async () => {
  if (!ctx.ready.value || !sidecar.available) return
  loading.value = true
  try {
    status.value = await git.status(ctx.workspaceRoot.value)
  } catch {
    status.value = null
  } finally {
    loading.value = false
  }
}

const stage = async (path: string) => {
  await git.stageFile(ctx.workspaceRoot.value, [path]).catch(() => undefined)
  await load()
}
const unstage = async (path: string) => {
  await git.unstageFile(ctx.workspaceRoot.value, [path]).catch(() => undefined)
  await load()
}

const doCommit = async () => {
  if (!canCommit.value) return
  try {
    await git.commit(ctx.workspaceRoot.value, { message: message.value.trim() })
    message.value = ''
    await load()
  } catch {
    // commit errors surface via the git manager; keep the message for retry
  }
}

const openGitManager = () => navigateTo('/git')

onMounted(async () => {
  await load()
  if (sidecar.available) {
    unlisten = await sidecar.onEvent((e) => {
      if (e.type === 'git:status:changed') load().catch(() => undefined)
    })
  }
})
onBeforeUnmount(() => {
  if (unlisten) unlisten()
})
</script>
