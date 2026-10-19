<template>
  <!-- Hàng input inline trong cây explorer (New File/Folder + Rename).
       Enter/blur commit, Esc huỷ; khi trùng tên `error` bật → viền đỏ, giữ
       focus cho sửa tiếp. -->
  <div
    class="my-0.5 flex h-[var(--lh-xl)] items-center gap-1 pr-1.5"
    :style="{ paddingLeft: pad + 'px' }"
  >
    <component :is="icon" :size="14" class="flex-none text-[color:var(--textFaint)]" />
    <!-- `min-h-0`: prototype.css ép input không-type min-height = --ctrl-h (36px)
         cho mọi control — reset để `h-5` thắng (VS Code: inline rename gọn,
         không bị hàng control chung đẩy lên). -->
    <Input
      ref="inputEl"
      v-model="draft"
      class="mr-1 h-5 min-h-0 min-w-0 flex-1 rounded-[var(--r-xs)] border bg-[color:var(--bgInput)] px-1.5 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--textFaint)]"
      :class="error ? 'border-[color:var(--danger)]' : 'border-[color:var(--accentBorder)]'"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
import { File, Folder } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  depth: number
  isDir: boolean
  initial: string
  error: boolean
}>()
const emit = defineEmits<{ commit: [name: string]; cancel: [] }>()

const draft = ref(props.initial)
// `Input` expose `{ el, focus, select, blur }` — lấy `el` để setSelectionRange.
const inputEl = ref<{ el: HTMLInputElement | null } | null>(null)
const icon = computed(() => (props.isDir ? Folder : File))
const pad = computed(() => 12 + props.depth * 14 + 12)
const placeholder = computed(() => (props.isDir ? 'Tên thư mục…' : 'Tên tệp (a/b/c.ts)…'))

// Blur sau Esc cũng gọi commit — chặn bằng cờ để Esc huỷ đúng một lần.
let cancelled = false
function commit(): void {
  if (cancelled) return
  emit('commit', draft.value)
}
function cancel(): void {
  cancelled = true
  emit('cancel')
}

onMounted(async () => {
  await nextTick()
  inputEl.value?.el?.focus()
  if (props.initial) {
    // Rename: bôi phần tên, bỏ phần đuôi mở rộng cho tiện sửa.
    const dot = props.initial.lastIndexOf('.')
    inputEl.value?.el?.setSelectionRange(0, dot > 0 ? dot : props.initial.length)
  }
})
</script>
