<template>
  <BaseModal :open="open" :title="tr('git.dirty_checkout.title')" size="sm" @close="emit('close')">
    <div class="p-4 text-[1em] flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div>{{ tr('git.dirty_checkout.question', { branch: targetBranch }) }}</div>
      <div :style="{ color: t.textFaint }">
        {{ tr('git.dirty_checkout.stash_hint') }} {{ tr('git.dirty_checkout.force_hint') }}
      </div>
      <div
        v-if="files.length > 0"
        class="max-h-40 overflow-y-auto rounded p-2 text-[1em] font-mono"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div
          v-for="f in files"
          :key="f.path"
          class="truncate"
          :style="{ color: t.textMuted }"
          :title="f.path"
        >
          {{ f.path }}
        </div>
      </div>
    </div>
    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton variant="secondary" @click="emit('stash-and-checkout')">
        {{ tr('git.dirty_checkout.stash_and_checkout') }}
      </AppButton>
      <AppButton variant="danger" @click="emit('force')">
        {{ tr('git.dirty_checkout.force_checkout') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import type { SidecarGitFileStatus } from '~/composables/useGitApi'

type Props = {
  open: boolean
  targetBranch: string
  files?: SidecarGitFileStatus[]
}

withDefaults(defineProps<Props>(), {
  files: () => [],
})

const emit = defineEmits<{
  close: []
  force: []
  'stash-and-checkout': []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
</script>
