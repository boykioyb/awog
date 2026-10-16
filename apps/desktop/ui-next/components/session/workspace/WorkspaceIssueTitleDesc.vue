<template>
  <!-- Tiêu đề + mô tả của issue theo khuôn GitHub: mặc định là CHỮ (tiêu đề to, mô tả
       render markdown); bấm Sửa (hoặc nháy đúp) mới thành ô nhập. Khi sửa có Lưu / Huỷ
       riêng — Lưu chỉ ghi hai field này rồi về dạng xem, modal vẫn mở (nút Lưu ở chân
       modal vẫn ghi cả form và đóng như cũ). -->
  <div v-if="!editing" class="group relative flex min-w-0 flex-col gap-2" @dblclick="startEdit">
    <div class="flex min-w-0 items-start gap-2">
      <h2 class="itd-title min-w-0 flex-1">{{ title || item.title }}</h2>
      <Button
        variant="ghost"
        size="iconSm"
        class="flex-none text-muted-foreground"
        :title="t('common.edit')"
        :aria-label="t('common.edit')"
        @click="startEdit"
      >
        <Pencil class="size-3.5" />
      </Button>
    </div>
    <div v-if="desc.trim()" class="itd-md">
      <template v-for="(seg, i) in segments" :key="i">
        <SessionMarkdownHtml v-if="seg.type === 'html'" :html="seg.html" />
      </template>
    </div>
    <p v-else class="m-0 text-sm text-muted-foreground">{{ t('board.desc.empty') }}</p>
  </div>

  <div v-else class="flex min-w-0 flex-col gap-2">
    <Input
      ref="titleInput"
      v-model="title"
      class="font-medium"
      :placeholder="t('sessions.workspace.group.field.title')"
      maxlength="200"
      @keydown.enter.prevent="saveText"
      @keydown.esc.stop.prevent="cancelEdit"
    />
    <div class="relative flex min-h-0 flex-col">
      <Textarea
        v-model="desc"
        class="min-h-[160px] resize-y pr-36"
        rows="10"
        :placeholder="t('sessions.workspace.group.field.desc')"
        @keydown.meta.enter.prevent="saveText"
        @keydown.ctrl.enter.prevent="saveText"
        @keydown.esc.stop.prevent="cancelEdit"
      />
      <!-- Viết mô tả bằng AI từ các phiên đã làm issue — chỉ điền vào ô. -->
      <Button
        variant="ghost"
        size="xs"
        class="absolute right-1.5 top-1.5 gap-1 text-muted-foreground"
        :disabled="describing"
        :title="t('board.ai.describeHint')"
        @click="emit('describe')"
      >
        <RefreshCw v-if="describing" class="size-3 animate-spin" />
        <Sparkles v-else class="size-3" />
        {{ describing ? t('board.ai.describing') : t('board.ai.describe') }}
      </Button>
    </div>
    <div class="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" :disabled="saving" @click="cancelEdit">
        {{ t('common.cancel') }}
      </Button>
      <Button size="sm" :disabled="saving || !title.trim()" @click="saveText">
        {{ t('common.save') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Pencil, RefreshCw, Sparkles } from 'lucide-vue-next'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import type { BoardItem } from '~/stores/board'

const props = defineProps<{ item: BoardItem; describing?: boolean }>()
const emit = defineEmits<{ describe: [] }>()
// Bản nháp DÙNG CHUNG với form của modal — nút Lưu ở chân modal ghi đúng thứ đang sửa.
const title = defineModel<string>('title', { required: true })
const desc = defineModel<string>('desc', { required: true })

const { t } = useI18n()
const board = useBoardStore()
const toast = useToast()
const { renderMarkdown } = useMarkdown()

const editing = ref(false)
const saving = ref(false)
const titleInput = useTemplateRef<{ focus?: () => void }>('titleInput')
const segments = computed(() => renderMarkdown(desc.value))

// Đổi sang item khác (điều hướng cha ↔ con trong modal) ⇒ về dạng xem.
watch(
  () => props.item.id,
  () => (editing.value = false),
)

async function startEdit(): Promise<void> {
  editing.value = true
  await nextTick()
  titleInput.value?.focus?.()
}

// Huỷ = trả bản nháp về đúng giá trị đang lưu của item.
function cancelEdit(): void {
  title.value = props.item.title
  desc.value = props.item.desc ?? ''
  editing.value = false
}

async function saveText(): Promise<void> {
  if (saving.value || !title.value.trim()) return
  saving.value = true
  try {
    const res = await board.upsertItem(props.item.projectId, {
      id: props.item.id,
      title: title.value.trim(),
      desc: desc.value.trim(),
    })
    if (!res) {
      toast.add({ title: t('board.desc.saveFailed'), color: 'error' })
      return
    }
    editing.value = false
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.itd-title {
  margin: 0;
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  font-weight: 600;
  color: var(--text);
  overflow-wrap: anywhere;
}
/* Mô tả dạng đọc: markdown transcript nhưng đệm gọn cho cột 9/12 của modal. */
.itd-md {
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  color: var(--text);
  overflow-wrap: anywhere;
}
.itd-md :deep(p:first-child) {
  margin-top: 0;
}
</style>
