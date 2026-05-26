<template>
  <div
    class="flex flex-col flex-shrink-0"
    :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <div class="px-3 py-2 flex items-center justify-between gap-2">
      <div class="text-[11px] uppercase tracking-wider" :style="{ color: t.textDim }">
        Commit message
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition"
          :style="generateBtnStyle"
          :disabled="generateDisabled"
          :title="
            store.stagedFiles.length === 0 ? 'Stage file trước khi generate' : 'Tạo message bằng AI'
          "
          @click="doGenerate"
        >
          <Loader2 v-if="store.isGeneratingMessage" :size="12" class="animate-spin" />
          <Sparkles v-else :size="12" />
          <span>{{ store.isGeneratingMessage ? 'Generating…' : 'Generate AI' }}</span>
        </button>
        <div class="text-[10px]" :style="{ color: t.textFaint }">
          {{ store.stagedFiles.length }} file(s) staged
        </div>
      </div>
    </div>
    <div class="px-3 pb-2">
      <textarea
        :value="store.commitMessage"
        rows="3"
        placeholder="Summary (required)&#10;&#10;Optional longer description"
        class="w-full rounded text-xs px-2 py-1.5 font-mono resize-none"
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
      <div v-if="inlineError" class="text-[10px] mt-1" :style="{ color: t.danger }">
        {{ inlineError }}
      </div>
    </div>
    <div class="px-3 py-2 flex items-center gap-2" :style="{ borderTop: `1px solid ${t.border}` }">
      <button
        class="flex-1 text-xs font-medium px-3 py-1.5 rounded transition"
        :style="commitBtnStyle"
        :disabled="commitDisabled"
        @click="doCommit"
      >
        Commit
      </button>
      <button
        class="text-xs px-3 py-1.5 rounded transition"
        :style="{
          background: t.bgInput,
          color: t.textMuted,
          border: `1px solid ${t.border}`,
        }"
        :disabled="store.commits.length === 0"
        @click="doAmend"
      >
        Amend
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2, Sparkles } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()

const focused = ref(false)
const inlineError = ref<string | null>(null)

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
    inlineError.value = 'Commit message không được rỗng'
    return
  }
  await store.commit(store.commitMessage)
}

const doAmend = async () => {
  if (store.commits.length === 0) return
  await store.amendCommit(store.commitMessage)
}
</script>
