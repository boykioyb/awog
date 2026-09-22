<template>
  <Teleport to="body">
    <div v-if="open" class="ltnp-wrap">
      <div class="ltnp-backdrop" @click="close" />
      <div class="ltnp" :style="posStyle" role="dialog" aria-modal="true">
        <textarea
          ref="areaRef"
          :value="modelValue"
          class="ltnp-area"
          :placeholder="t('logtime.form.note')"
          :disabled="refining"
          @input="onInput"
          @keydown.esc.prevent="close"
          @keydown.meta.enter.prevent="close"
          @keydown.ctrl.enter.prevent="close"
        />
        <div class="ltnp-foot">
          <!-- Khai thác chữ đang gõ thành note nghiệp vụ đầy đủ. -->
          <button type="button" class="btn ltnp-btn" :disabled="refining" @click="onRefine">
            <Icon :name="refining ? 'refresh' : 'sparkles'" :class="{ 'ltnp-spin': refining }" />
            {{ refining ? t('logtime.form.noteRefining') : t('logtime.form.noteRefine') }}
          </button>
          <span class="ltnp-hint">{{ t('logtime.form.noteHint') }}</span>
          <span class="ltnp-sp" />
          <button type="button" class="btn pri ltnp-btn" @click="close">
            {{ t('logtime.form.noteDone') }}
          </button>
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

const areaRef = useTemplateRef<HTMLTextAreaElement>('areaRef')
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
    void nextTick(() => areaRef.value?.focus())
  },
  { immediate: true },
)

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

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

<style scoped>
.ltnp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
}
.ltnp {
  position: fixed;
  z-index: 121;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px;
  background: var(--bgPanel);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.ltnp-area {
  width: 100%;
  min-height: 96px;
  max-height: 40vh;
  resize: vertical;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  padding: 9px 11px;
  outline: none;
}
.ltnp-area:focus {
  border-color: var(--accentBorder);
}
.ltnp-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.ltnp-btn {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltnp-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.ltnp-sp {
  flex: 1;
}
.ltnp-spin {
  animation: ltnp-rot 0.9s linear infinite;
}
@keyframes ltnp-rot {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ltnp-spin {
    animation: none;
  }
}
</style>
