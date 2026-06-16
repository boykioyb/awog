<template>
  <BaseModal :open="open" :title="tr('git.pr.title')" size="sm" @close="emit('close')">
    <div class="p-4 flex flex-col gap-4 text-[1em]">
      <div class="flex items-start gap-2.5">
        <GitPullRequest :size="16" class="flex-shrink-0 mt-0.5" :style="{ color: t.accent }" />
        <span :style="{ color: t.textMuted }">{{ tr('git.pr.subtitle') }}</span>
      </div>

      <!-- From (head branch — read-only) -->
      <div class="flex items-center gap-3">
        <span class="w-12 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.pr.from_label') }}
        </span>
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 rounded min-w-0 flex-1"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <GitBranchIcon :size="13" class="flex-shrink-0" :style="{ color: t.textDim }" />
          <span class="font-mono truncate" :style="{ color: t.text }">{{ head }}</span>
        </div>
      </div>

      <!-- Into (base branch — selectable) -->
      <div class="flex items-center gap-3">
        <span class="w-12 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.pr.base_label') }}
        </span>
        <div class="flex-1 min-w-0">
          <AppSelect v-model="base" mono :disabled="baseBranches.length === 0">
            <option v-if="baseBranches.length === 0" value="">
              {{ tr('git.pr.no_base') }}
            </option>
            <option v-for="b in baseBranches" :key="b" :value="b">{{ b }}</option>
          </AppSelect>
        </div>
      </div>

      <!-- Forge hint: unknown hosts fall back to opening the repo home page. -->
      <span
        v-if="repo && !forge"
        class="text-[12px] pl-[3.75rem] -mt-2"
        :style="{ color: t.warning }"
      >
        {{ tr('git.pr.unknown_forge', { host: repo.host }) }}
      </span>

      <!-- Resolved URL preview -->
      <div v-if="previewUrl" class="flex flex-col gap-1">
        <span class="text-[12px]" :style="{ color: t.textDim }">{{ tr('git.pr.opens') }}</span>
        <span
          class="font-mono text-[12px] break-all px-2 py-1.5 rounded"
          :style="{ background: t.bgSubtle, color: t.textMuted, border: `1px solid ${t.border}` }"
        >
          {{ previewUrl }}
        </span>
      </div>
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        {{ tr('common.cancel') }}
      </button>
      <button
        class="px-3 py-1.5 text-[1em] rounded font-medium transition"
        :style="{
          background: t.accent,
          color: t.accentText,
          opacity: canSubmit ? 1 : 0.6,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        {{ tr('git.pr.submit') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { GitBranch as GitBranchIcon, GitPullRequest } from 'lucide-vue-next'
import { buildPullRequestUrl, detectForge, type RemoteRepo } from '~/utils/git-remote-url'

const props = defineProps<{
  open: boolean
  head: string
  baseBranches: string[]
  defaultBase: string
  repo: RemoteRepo | null
}>()

const emit = defineEmits<{
  close: []
  submit: [url: string]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const base = ref('')

// Re-seed the base each time the modal opens (Sublime Merge clears on open).
watch(
  () => props.open,
  (next) => {
    if (next) base.value = props.defaultBase
  },
  { immediate: true },
)

const forge = computed(() => (props.repo ? detectForge(props.repo.host) : null))

const previewUrl = computed(() =>
  props.repo && props.head
    ? buildPullRequestUrl(props.repo, props.head, base.value || undefined)
    : '',
)

const canSubmit = computed(() => previewUrl.value.length > 0)

const onSubmit = () => {
  if (!canSubmit.value) return
  emit('submit', previewUrl.value)
}
</script>
