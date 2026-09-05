<template>
  <!-- Teleport to body: escape any ancestor stacking/overflow so the scrim covers
       the full window. Mirrors PreviewModal's overlay idiom (.ovl.on scrim). -->
  <Teleport to="body">
    <div v-if="open" class="ovl on smdovl" @click.self="onScrim">
      <div class="smd" role="dialog" aria-modal="true">
        <div class="smdhd">
          <span class="smdtitle">{{ title }}</span>
          <button class="pvx" type="button" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="smdbody">
          <slot />
        </div>
        <div v-if="$slots.footer" class="smdfoot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Small dialog shell shared by the Models OAuth / Codex / Account-edit dialogs.
// Renders the .ovl scrim + a centered card with a titled header (close button),
// a body slot and an optional footer slot. Escape closes; clicking the scrim
// closes unless `lockScrim` is set (in-flight flows that shouldn't dismiss).
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    lockScrim?: boolean
  }>(),
  { lockScrim: false },
)

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

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
/* Center the card (the shared .ovl aligns to the top for the command palette). */
.smdovl {
  align-items: center;
  padding-top: 0;
}
.smd {
  width: 480px;
  max-width: 92vw;
  max-height: 84vh;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
}
.smdhd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.smdtitle {
  flex: 1;
  font-size: var(--fs-lg);
  font-weight: 650;
  color: var(--text);
}
.pvx {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
  background: transparent;
  border: none;
}
.pvx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.smdbody {
  overflow-y: auto;
  padding: 16px 18px;
}
.smdfoot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
}
</style>
