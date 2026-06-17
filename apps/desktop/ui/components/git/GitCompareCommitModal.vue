<template>
  <BaseModal :open="open" size="xl" @close="emit('close')">
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <GitCompare :size="14" :style="{ color: t.accent }" />
        <div class="text-[1em] font-medium truncate" :style="{ color: t.text }">
          {{ tr('git.compare.title') }}
          <span class="font-mono" :style="{ color: t.accent }">{{ targetShortHash }}</span>
          {{ tr('git.compare.to_working_tree') }}
        </div>
      </div>
    </template>

    <div class="flex h-[70vh] overflow-hidden">
      <!-- File list -->
      <div
        class="w-[260px] flex-shrink-0 overflow-y-auto"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <div v-if="loading" class="px-3 py-2 text-[1em]" :style="{ color: t.textDim }">
          {{ tr('git.compare.loading') }}
        </div>
        <div
          v-else-if="files.length === 0"
          class="px-3 py-2 text-[1em]"
          :style="{ color: t.textDim }"
        >
          {{ tr('git.compare.no_diff') }}
        </div>
        <button
          v-for="(f, i) in files"
          v-else
          :key="f.path"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[1em] font-mono transition"
          :style="{
            background: activeIndex === i ? t.bgActive : 'transparent',
            color: t.text,
          }"
          @click="activeIndex = i"
        >
          <span class="truncate" :style="{ color: t.textMuted }">{{ f.path }}</span>
        </button>
      </div>

      <!-- Diff -->
      <div class="flex-1 overflow-hidden">
        <GitDiffViewer v-if="activeFile" :diff="activeFile" />
        <div
          v-else
          class="h-full flex items-center justify-center text-[1em]"
          :style="{ color: t.textDim }"
        >
          {{ loading ? tr('common.loading') : tr('git.compare.select_file') }}
        </div>
      </div>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.close') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { GitCompare } from 'lucide-vue-next'
import type { GitFileDiff } from '~/types'

type Props = {
  open: boolean
  targetShortHash: string
  files: GitFileDiff[]
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const activeIndex = ref(0)

// Reset the active index whenever a new compare opens or the file list changes
// — otherwise opening a smaller diff after a larger one could leave the index
// pointing past the end.
watch(
  () => [props.open, props.files] as const,
  () => {
    activeIndex.value = 0
  },
)

const activeFile = computed<GitFileDiff | null>(() => props.files[activeIndex.value] ?? null)
</script>
