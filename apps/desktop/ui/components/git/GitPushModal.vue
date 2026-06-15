<template>
  <BaseModal :open="open" :title="tr('git.push_dialog.title')" size="sm" @close="emit('close')">
    <div class="p-4 flex flex-col gap-4 text-[1em]">
      <div class="flex items-start gap-2.5">
        <ArrowUpFromLine :size="16" class="flex-shrink-0 mt-0.5" :style="{ color: t.accent }" />
        <span :style="{ color: t.textMuted }">{{ tr('git.push_dialog.subtitle') }}</span>
      </div>

      <!-- Branch (current checked-out branch — read-only) -->
      <div class="flex items-center gap-3">
        <span class="w-14 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.push_dialog.branch_label') }}
        </span>
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 rounded min-w-0 flex-1"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <GitBranchIcon :size="13" class="flex-shrink-0" :style="{ color: t.textDim }" />
          <span class="font-mono truncate" :style="{ color: t.text }">{{ currentBranch }}</span>
        </div>
      </div>

      <!-- To (remote) -->
      <div class="flex items-center gap-3">
        <span class="w-14 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.push_dialog.to_label') }}
        </span>
        <div class="flex-1 min-w-0">
          <AppSelect v-model="selectedRemote" mono :disabled="remoteNames.length === 0">
            <option v-if="remoteNames.length === 0" value="">
              {{ tr('git.push_dialog.no_remote') }}
            </option>
            <option v-for="name in remoteNames" :key="name" :value="name">
              {{ name }}/{{ currentBranch }}
            </option>
          </AppSelect>
        </div>
      </div>

      <!-- Upstream / ahead hints -->
      <div class="flex flex-col gap-1 pl-[4.25rem] -mt-2">
        <span v-if="needsUpstream" class="text-[12px]" :style="{ color: t.warning }">
          {{
            tr('git.push_dialog.set_upstream_hint', {
              remote: selectedRemote,
              branch: currentBranch,
            })
          }}
        </span>
        <span v-else-if="ahead > 0" class="text-[12px]" :style="{ color: t.textFaint }">
          {{ tr('git.push_dialog.ahead_summary', { count: ahead }) }}
        </span>
      </div>

      <div class="h-px" :style="{ background: t.border }" />

      <!-- Push all tags -->
      <button
        type="button"
        class="flex items-center justify-between gap-3 text-left"
        @click="pushTags = !pushTags"
      >
        <span :style="{ color: t.text }">{{ tr('git.push_dialog.push_tags') }}</span>
        <AppToggle :model-value="pushTags" @update:model-value="pushTags = $event" />
      </button>

      <!-- Force push -->
      <div class="flex flex-col gap-1">
        <button
          type="button"
          class="flex items-center justify-between gap-3 text-left"
          @click="force = !force"
        >
          <span :style="{ color: force ? t.danger : t.text }">
            {{ tr('git.push_dialog.force') }}
          </span>
          <AppToggle :model-value="force" @update:model-value="force = $event" />
        </button>
        <span v-if="force" class="text-[12px]" :style="{ color: t.danger }">
          {{ tr('git.push_dialog.force_hint') }}
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
          background: force ? t.danger : t.accent,
          color: t.accentText,
          opacity: canPush ? 1 : 0.6,
          cursor: canPush ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canPush"
        @click="onPush"
      >
        {{ tr('git.push_dialog.submit') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ArrowUpFromLine, GitBranch as GitBranchIcon } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const currentBranch = computed(() => store.currentBranch ?? '')
const ahead = computed(() => store.ahead)
const remoteNames = computed(() => store.remotes.map((r) => r.name))

// Parse the tracked upstream (e.g. `origin/feature/x`) into its remote, by
// matching against a known remote name prefix — branch names contain slashes,
// so splitting on the first `/` would be wrong for `feature/x`.
const upstreamRemote = computed<string | null>(() => {
  const up = store.currentBranchInfo?.upstream
  if (!up) return null
  const match = store.remotes.find((r) => up === r.name || up.startsWith(`${r.name}/`))
  return match?.name ?? up.split('/')[0] ?? null
})

const needsUpstream = computed(() => !store.currentBranchInfo?.upstream)

const selectedRemote = ref('')
const pushTags = ref(false)
const force = ref(false)

// Re-seed each time the dialog opens: prefer the tracked upstream's remote,
// else the first configured remote, else the conventional `origin`.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    // Prefer the tracked upstream's remote, else the first configured remote.
    // Empty when the repo has no remote at all → Push stays disabled.
    selectedRemote.value = upstreamRemote.value ?? remoteNames.value[0] ?? ''
    pushTags.value = false
    force.value = false
  },
  { immediate: true },
)

const canPush = computed(() => !store.isPushing && selectedRemote.value.length > 0)

const onPush = () => {
  if (!canPush.value) return
  store.push({
    remote: selectedRemote.value,
    pushTags: pushTags.value,
    force: force.value,
    setUpstream: needsUpstream.value,
  })
}
</script>
