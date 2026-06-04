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
      <button
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        {{ tr('common.cancel') }}
      </button>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="emit('stash-and-checkout')"
      >
        {{ tr('git.dirty_checkout.stash_and_checkout') }}
      </button>
      <button
        class="px-3 py-1.5 text-[1em] rounded font-medium transition"
        :style="{
          background: t.dangerBg,
          color: t.danger,
          border: `1px solid ${t.dangerBorder}`,
        }"
        @click="emit('force')"
      >
        {{ tr('git.dirty_checkout.force_checkout') }}
      </button>
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
