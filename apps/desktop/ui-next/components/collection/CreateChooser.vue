<template>
  <!-- "New" → chọn đường tạo (khuôn create-agent của Multica): hai card lớn —
       Start blank (form tay) | Build with AI (chat/draft). Hai page Agents và
       Teams dùng chung. -->
  <LibraryEntityModal :open="open" :title="title" :width="520" @close="emit('close')">
    <div class="cc-grid">
      <button class="cc-opt" @click="emit('blank')">
        <span class="cc-ic">
          <Icon name="edit" class="size-[18px]" />
        </span>
        <span class="cc-t">{{ t('collection.create.blank') }}</span>
        <span class="cc-d">{{ blankDesc }}</span>
      </button>
      <button class="cc-opt" @click="emit('ai')">
        <span class="cc-ic acc">
          <Icon name="sparkles" class="size-[18px]" />
        </span>
        <span class="cc-t">{{ t('collection.create.ai') }}</span>
        <span class="cc-d">{{ aiDesc }}</span>
      </button>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
import Icon from '~/components/Icon.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useI18n } from '~/composables/useI18n'

defineProps<{
  open: boolean
  title: string
  blankDesc: string
  aiDesc: string
}>()

const emit = defineEmits<{ close: []; blank: []; ai: [] }>()
const { t } = useI18n()
</script>

<style scoped>
.cc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.cc-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: transparent;
  font-family: var(--sans);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.cc-opt:hover {
  border-color: var(--ring);
  box-shadow: var(--shadow-sm);
}
.cc-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--muted-foreground);
}
.cc-ic.acc {
  color: var(--primary);
  border-color: rgb(from var(--primary) r g b / 45%);
}
.cc-t {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--foreground);
}
.cc-d {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
}
@media (max-width: 520px) {
  .cc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
