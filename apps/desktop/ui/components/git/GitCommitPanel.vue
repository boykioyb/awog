<template>
  <div
    class="flex flex-col flex-shrink-0"
    :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <!-- Detached HEAD commit warning (AC-42) -->
    <div
      v-if="pendingDetachedCommit"
      class="fixed inset-0 z-50 flex items-center justify-center px-4"
      :style="{ background: 'rgba(0,0,0,0.55)' }"
      @click.self="pendingDetachedCommit = false"
    >
      <div
        class="w-full max-w-md rounded-xl p-4 flex flex-col gap-3"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          color: t.text,
        }"
      >
        <div class="flex items-center gap-2">
          <AlertTriangle :size="16" :style="{ color: t.warning }" />
          <div class="text-[1em] font-medium">{{ tr('git.commit_panel.detached_title') }}</div>
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
          {{
            tr('git.commit_panel.detached_body', {
              sha: store.detachedAt ?? '',
              branch: `temp/${store.detachedAt ?? ''}`,
            })
          }}
        </div>
        <div class="flex items-center gap-2 justify-end pt-1">
          <button
            class="text-[1em] px-3 py-1.5 rounded-lg transition"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
            @click="pendingDetachedCommit = false"
          >
            {{ tr('common.cancel') }}
          </button>
          <button
            class="text-[1em] px-3 py-1.5 rounded-lg transition"
            :style="{
              background: t.bgInput,
              color: t.accent,
              border: `1px solid ${t.accent}`,
            }"
            @click="onCreateBranchThenCommit"
          >
            {{ tr('git.commit_panel.create_branch_then_commit') }}
          </button>
          <button
            class="text-[1em] px-3 py-1.5 rounded-lg transition font-medium"
            :style="{
              background: t.warning,
              color: t.accentText,
              border: `1px solid ${t.warning}`,
            }"
            @click="onCommitAnyway"
          >
            {{ tr('git.commit_panel.commit_anyway') }}
          </button>
        </div>
      </div>
    </div>
    <div class="px-3 py-2 flex items-center justify-between gap-2">
      <div class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
        {{ tr('git.commit_panel.message_header') }}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1 text-[1em] px-2 py-1 rounded-lg transition"
          :style="generateBtnStyle"
          :disabled="generateDisabled"
          :title="
            store.stagedFiles.length === 0
              ? tr('git.commit_panel.generate_disabled_hint')
              : tr('git.commit_panel.generate_hint')
          "
          @click="doGenerate"
        >
          <Loader2 v-if="store.isGeneratingMessage" :size="12" class="animate-spin" />
          <Sparkles v-else :size="12" />
          <span>
            {{
              store.isGeneratingMessage
                ? tr('git.commit_panel.generating')
                : tr('git.commit_panel.generate')
            }}
          </span>
        </button>
        <div class="text-[1em]" :style="{ color: t.textFaint }">
          {{ tr('git.commit_panel.files_staged', { count: store.stagedFiles.length }) }}
        </div>
      </div>
    </div>
    <div class="px-3 pb-2">
      <textarea
        :value="store.commitMessage"
        rows="3"
        :placeholder="tr('git.commit_panel.message_placeholder')"
        class="w-full rounded-lg text-[1em] px-2.5 py-2 font-mono resize-y min-h-[5rem]"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${focused ? t.borderFocus : t.border}`,
          outline: 'none',
        }"
        @input="onInput"
        @focus="focused = true"
        @blur="focused = false"
      />
      <div v-if="inlineError" class="text-[1em] mt-1" :style="{ color: t.danger }">
        {{ inlineError }}
      </div>
    </div>
    <div class="px-3 py-2 flex items-center gap-2" :style="{ borderTop: `1px solid ${t.border}` }">
      <button
        class="flex-1 text-[1em] font-medium px-3 py-1.5 rounded-lg transition"
        :style="commitBtnStyle"
        :disabled="commitDisabled"
        @click="doCommit"
      >
        {{ tr('git.commit_panel.commit') }}
      </button>
      <button
        class="text-[1em] px-3 py-1.5 rounded-lg transition"
        :style="{
          background: t.bgInput,
          color: t.textMuted,
          border: `1px solid ${t.border}`,
        }"
        :disabled="store.commits.length === 0"
        @click="doAmend"
      >
        {{ tr('git.commit_panel.amend') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle, Loader2, Sparkles } from 'lucide-vue-next'

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const focused = ref(false)
const inlineError = ref<string | null>(null)
// Detached HEAD interception (AC-42). When set, render the confirm modal.
const pendingDetachedCommit = ref<false | { mode: 'commit' | 'amend' }>(false)

const generateDisabled = computed(() => store.isGeneratingMessage || store.stagedFiles.length === 0)

const generateBtnStyle = computed(() => ({
  background: generateDisabled.value ? t.value.bgInput : t.value.bgPanel,
  color: generateDisabled.value ? t.value.textDim : t.value.accent,
  border: `1px solid ${generateDisabled.value ? t.value.border : t.value.accent}`,
  cursor: generateDisabled.value ? 'not-allowed' : 'pointer',
}))

const doGenerate = async () => {
  if (generateDisabled.value) return
  await store.generateCommitMessage()
  if (inlineError.value && store.commitMessage.trim()) inlineError.value = null
}

const onInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  store.setCommitMessage(target.value)
  if (inlineError.value && target.value.trim()) inlineError.value = null
}

const commitDisabled = computed(() => store.stagedFiles.length === 0)

const commitBtnStyle = computed(() => ({
  background: commitDisabled.value ? t.value.bgInput : t.value.accent,
  color: commitDisabled.value ? t.value.textDim : t.value.accentText,
  border: `1px solid ${commitDisabled.value ? t.value.border : t.value.accent}`,
  cursor: commitDisabled.value ? 'not-allowed' : 'pointer',
}))

const doCommit = async () => {
  if (commitDisabled.value) return
  if (!store.commitMessage.trim()) {
    inlineError.value = tr('git.commit_panel.empty_message')
    return
  }
  if (store.isDetached) {
    pendingDetachedCommit.value = { mode: 'commit' }
    return
  }
  await store.commit(store.commitMessage)
}

const doAmend = async () => {
  if (store.commits.length === 0) return
  if (store.isDetached) {
    pendingDetachedCommit.value = { mode: 'amend' }
    return
  }
  await store.amendCommit(store.commitMessage)
}

const executePendingCommit = async () => {
  const pending = pendingDetachedCommit.value
  if (!pending) return
  pendingDetachedCommit.value = false
  if (pending.mode === 'amend') {
    await store.amendCommit(store.commitMessage)
  } else {
    await store.commit(store.commitMessage)
  }
}

const onCommitAnyway = async () => {
  await executePendingCommit()
}

const onCreateBranchThenCommit = async () => {
  const pending = pendingDetachedCommit.value
  if (!pending) return
  const sha7 = store.detachedAt ?? 'detached'
  const branchName = `temp/${sha7}`
  pendingDetachedCommit.value = false
  // Create + checkout the temp branch so the upcoming commit lands on it.
  await store.createBranch(branchName, undefined, true)
  if (pending.mode === 'amend') {
    await store.amendCommit(store.commitMessage)
  } else {
    await store.commit(store.commitMessage)
  }
}
</script>
