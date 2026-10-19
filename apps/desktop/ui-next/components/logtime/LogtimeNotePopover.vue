<template>
  <Teleport to="body">
    <!-- Popover tự định vị theo `anchor` (đo lúc mở, mở lên hay xuống tuỳ chỗ trống) nên
         không dùng `Popover` của reka: nó cần một PopoverAnchor trong cây, còn neo ở đây
         là phần tử của form/hàng cha. Backdrop trong suốt bắt click ngoài. -->
    <div v-if="open">
      <div class="fixed inset-0 z-120" @click="close" />
      <div
        class="fixed z-121 flex flex-col gap-2 rounded-xl border border-input bg-sidebar p-3 shadow-lg"
        :style="posStyle"
        role="dialog"
        data-state="open"
        aria-modal="true"
      >
        <Textarea
          ref="areaRef"
          :model-value="modelValue"
          class="max-h-[40vh] min-h-24 resize-y bg-muted px-3 py-2 text-base leading-relaxed focus-visible:border-selected-border"
          :placeholder="t('logtime.form.note')"
          :disabled="refining"
          @update:model-value="emit('update:modelValue', String($event))"
          @keydown.esc.prevent="close"
          @keydown.meta.enter.prevent="close"
          @keydown.ctrl.enter.prevent="close"
        />
        <div class="flex flex-wrap items-center gap-2">
          <!-- Khai thác chữ đang gõ thành note nghiệp vụ đầy đủ. -->
          <Button type="button" :disabled="refining" variant="outline" @click="onRefine">
            <Icon
              :name="refining ? 'refresh' : 'sparkles'"
              :class="{ 'animate-spin motion-reduce:animate-none': refining }"
            />
            {{ refining ? t('logtime.form.noteRefining') : t('logtime.form.noteRefine') }}
          </Button>
          <span class="text-xs text-faint">{{ t('logtime.form.noteHint') }}</span>
          <span class="flex-1" />
          <Button type="button" variant="default" @click="close">
            {{ t('logtime.form.noteDone') }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Popover sửa note dùng chung cho form nhanh và LogtimeRow: textarea đa dòng + nút
// "Sửa bằng AI" (khai thác chữ đang gõ thành note nghiệp vụ). Tự định vị theo `anchor`,
// mở lên hay xuống tuỳ chỗ còn trống. Teleport ra body + backdrop bắt click ngoài.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import Button from '~/components/ui/button/Button.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'

const props = defineProps<{
  open: boolean
  modelValue: string
  anchor: HTMLElement | null
  projectKey: string
  issue?: number
  sourceRefId?: string
  kind?: 'session' | 'task'
}>()
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()
const { refineText } = useLogtimeManager()

// Textarea là component shadcn ⇒ template ref là instance, phần tử thật ở `$el`.
const areaRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('areaRef')
const refining = ref(false)
// Vị trí cố định tính lúc mở; `dir` = neo trên (mở lên) hay neo dưới (mở xuống).
const pos = ref({ left: 0, width: 0, y: 0, dir: 'up' as 'up' | 'down' })

const posStyle = computed(() =>
  pos.value.dir === 'up'
    ? { left: `${pos.value.left}px`, width: `${pos.value.width}px`, bottom: `${pos.value.y}px` }
    : { left: `${pos.value.left}px`, width: `${pos.value.width}px`, top: `${pos.value.y}px` },
)

function measure(): void {
  const el = props.anchor
  if (!el) return
  const r = el.getBoundingClientRect()
  // Neo ở nửa dưới màn hình ⇒ mở LÊN (không bị mép dưới cắt); ngược lại mở xuống.
  if (r.top > window.innerHeight / 2) {
    pos.value = { left: r.left, width: r.width, y: window.innerHeight - r.top + 6, dir: 'up' }
  } else {
    pos.value = { left: r.left, width: r.width, y: r.bottom + 6, dir: 'down' }
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    measure()
    void nextTick(() => areaRef.value?.$el.focus())
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function onRefine(): Promise<void> {
  refining.value = true
  try {
    const note = await refineText(props.modelValue, {
      projectKey: props.projectKey,
      ...(props.issue !== undefined ? { issue: props.issue } : {}),
      ...(props.sourceRefId ? { sourceRefId: props.sourceRefId } : {}),
      ...(props.kind ? { kind: props.kind } : {}),
    })
    if (note) emit('update:modelValue', note)
  } finally {
    refining.value = false
  }
}
</script>
