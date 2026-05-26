<template>
  <BaseModal :open="open" title="Uncommitted changes" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-1" :style="{ color: t.textMuted }">
      <div>
        Workspace có change uncommitted. Chuyển sang
        <span class="font-mono">{{ targetBranch }}</span>
        bằng cách nào?
      </div>
      <div :style="{ color: t.textFaint }">
        <span class="font-medium" :style="{ color: t.textMuted }">Keep:</span>
        mang change theo (chỉ work khi không conflict với branch đích).
        <span class="font-medium" :style="{ color: t.textMuted }">Stash:</span>
        cất tạm rồi checkout sạch.
        <span class="font-medium" :style="{ color: t.textMuted }">Discard:</span>
        xóa hết change.
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
          background: t.dangerBg,
          color: t.danger,
          border: `1px solid ${t.dangerBorder}`,
        }"
        @click="emit('discard')"
      >
        Discard & checkout
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="emit('keep')"
      >
        Keep & checkout
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('stash')"
      >
        Stash & checkout
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
type Props = {
  open: boolean
  targetBranch: string
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
  discard: []
  keep: []
  stash: []
}>()

const { t } = useTheme()
</script>
