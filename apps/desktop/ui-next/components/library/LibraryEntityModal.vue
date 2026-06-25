<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on lem-ovl" @click.self="onScrim">
      <div class="lem" :style="{ width: widthPx }" role="dialog" aria-modal="true">
        <div class="lem-hd">
          <span class="lem-title">{{ title }}</span>
          <span v-if="$slots['header-extra']" class="lem-hx"><slot name="header-extra" /></span>
          <span style="flex: 1" />
          <button class="iconbtn lem-x" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="lem-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="lem-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Generic library modal shell — the BaseModal/EditorShell idiom for ui-next,
// rendered in prototype CSS to match SettingsModelDialog (`.ovl` scrim + a
// centered card with a titled header, a body slot, and an optional footer slot
// for action buttons). Used by every library feature's editor / body-edit
// dialog. Escape + scrim close (unless `lockScrim` is set for in-flight flows).
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    lockScrim?: boolean
    // Card width in px; defaults to 560 (form editors). Pass a larger value for
    // wide editors. Capped to 94vw responsively.
    width?: number
  }>(),
  { lockScrim: false, width: 560 },
)

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const widthPx = `${props.width}px`

const onScrim = () => {
  if (!props.lockScrim) emit('close')
}
const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape' && !props.lockScrim) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Center the card (the shared .ovl aligns to top for the command palette). */
.lem-ovl {
  align-items: center;
  padding-top: 0;
}
.lem {
  max-width: 94vw;
  max-height: 86vh;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
}
.lem-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.lem-title {
  font-size: 1.1154rem;
  font-weight: 650;
  color: var(--text);
}
.lem-hx {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lem-x {
  width: 28px;
  height: 28px;
}
.lem-body {
  overflow-y: auto;
  padding: 18px;
}
.lem-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
}
</style>
