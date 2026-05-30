<template>
  <BaseModal :open="open" title="Branch đã diverge" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">Local branch và upstream đã đi theo hai hướng khác nhau.</div>
      <div :style="{ color: t.textMuted }">Fast-forward không khả thi. Chọn cách hợp nhất:</div>
      <ul class="list-disc pl-5 mt-1 space-y-1" :style="{ color: t.textFaint }">
        <li>
          <span class="font-medium" :style="{ color: t.textMuted }">Merge:</span>
          tạo commit hợp nhất, giữ lịch sử cả hai nhánh.
        </li>
        <li>
          <span class="font-medium" :style="{ color: t.textMuted }">Rebase:</span>
          phát lại commit của local lên trên upstream, lịch sử thẳng.
        </li>
      </ul>
    </div>
    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        Hủy
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="emit('choose-rebase')"
      >
        Rebase
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('choose-merge')"
      >
        Merge
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'choose-merge': []
  'choose-rebase': []
}>()

const { t } = useTheme()
</script>
