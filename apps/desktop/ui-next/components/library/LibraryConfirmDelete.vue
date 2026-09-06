<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on lcd-ovl" @click.self="emit('cancel')">
      <div class="lcd-card" role="dialog" aria-modal="true">
        <div class="lcd-head">
          <Icon
            name="alert"
            class="lcd-icn"
            :style="{ color: kind === 'danger' ? 'var(--danger)' : 'var(--accent)' }"
          />
          <span class="lcd-title">{{ title }}</span>
        </div>
        <div class="lcd-body">{{ description }}</div>
        <slot name="extra" />
        <div class="lcd-foot">
          <button class="btn" @click="emit('cancel')">
            {{ cancelLabel || t('common.cancel') }}
          </button>
          <button
            class="btn"
            :class="{ pri: kind !== 'danger' }"
            :style="
              kind === 'danger'
                ? { background: 'var(--danger)', color: 'var(--bg)', borderColor: 'transparent' }
                : undefined
            "
            @click="emit('confirm')"
          >
            {{ confirmLabel || (kind === 'danger' ? t('common.delete') : t('common.confirm')) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Shared confirm-delete dialog for every library feature (skills, agents,
// commands, rules, hooks, connections). Port of the old UI ConfirmDeleteModal,
// rendered in prototype CSS (centered card over the `.ovl` scrim — matching
// PreviewModal/GitPromptModal). `kind` controls the icon color + confirm style;
// defaults to 'danger' so the common Delete flow stays red. Caller owns the
// open state + supplies localized title/description.
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    kind?: 'danger' | 'primary'
    confirmLabel?: string
    cancelLabel?: string
  }>(),
  { kind: 'danger', confirmLabel: '', cancelLabel: '' },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()

const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') emit('cancel')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Center the card (the shared .ovl aligns to top for the command palette). */
.lcd-ovl {
  align-items: center;
  padding-top: 0;
  /* Topmost imperative dialog — match TextPromptHost (200) so a confirm raised
     from inside another modal (e.g. the session Git modal at z-120, the Git
     prompt modal at z-150) stacks above it rather than behind. */
  z-index: 200;
}
.lcd-card {
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.lcd-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.lcd-icn {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.lcd-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.lcd-body {
  font-size: var(--fs-sm);
  color: var(--textMuted);
  line-height: 1.6;
  white-space: pre-wrap;
}
.lcd-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
