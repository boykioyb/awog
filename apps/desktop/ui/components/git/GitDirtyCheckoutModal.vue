<template>
  <BaseModal :open="open" title="Uncommitted changes" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div>
        Workspace có change uncommitted. Chuyển sang
        <span class="font-mono">{{ targetBranch }}</span>
        bằng cách nào?
      </div>
      <div :style="{ color: t.textFaint }">
        <span class="font-medium" :style="{ color: t.textMuted }">Stash:</span>
        cất change vào stash, checkout sạch, sau đó pop lại.
        <span class="font-medium" :style="{ color: t.textMuted }">Force:</span>
        bỏ qua check — change sẽ bị git ghi đè nếu xung đột.
      </div>
      <div
        v-if="files.length > 0"
        class="max-h-40 overflow-y-auto rounded p-2 text-[0.79em] font-mono"
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
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="emit('stash-and-checkout')"
      >
        Stash & checkout
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{
          background: t.dangerBg,
          color: t.danger,
          border: `1px solid ${t.dangerBorder}`,
        }"
        @click="emit('force')"
      >
        Force checkout
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
</script>
