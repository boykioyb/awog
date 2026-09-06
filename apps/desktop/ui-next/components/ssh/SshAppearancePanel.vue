<template>
  <div class="tap" role="dialog" :aria-label="t('ssh.appearance.title')">
    <div class="tap-head">
      <span class="tap-title">{{ t('ssh.appearance.title') }}</span>
      <button
        class="tap-x"
        type="button"
        :title="t('ssh.appearance.close')"
        :aria-label="t('ssh.appearance.close')"
        @click="emit('close')"
      >
        <Icon name="x" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="tap-body">
      <!-- Theme preset -->
      <div class="tap-group">
        <div class="tap-label">{{ t('ssh.appearance.theme') }}</div>
        <div class="tap-presets">
          <button
            v-for="p in store.presets"
            :key="p.id"
            class="tap-preset"
            :class="{ on: p.id === store.presetId }"
            type="button"
            @click="store.setPreset(p.id)"
          >
            <span class="tap-swatch" :style="{ background: swatchBg(p) }">
              <span class="tap-swatch-txt" :style="{ color: swatchFg(p) }">Aa</span>
              <span class="tap-swatch-dots">
                <i v-for="(c, i) in swatchDots(p)" :key="i" :style="{ background: c }" />
              </span>
            </span>
            <span class="tap-preset-name">{{ p.name }}</span>
            <Icon v-if="p.id === store.presetId" name="check" class="tap-check" />
          </button>
        </div>
      </div>

      <!-- Font size -->
      <div class="tap-group">
        <div class="tap-label">{{ t('ssh.appearance.fontSize') }}</div>
        <div class="tap-stepper">
          <button
            class="tap-step"
            type="button"
            :disabled="store.fontSize <= FONT_SIZE_MIN"
            :aria-label="t('ssh.appearance.fontSizeDown')"
            @click="store.setFontSize(store.fontSize - 1)"
          >
            <Icon name="minus" style="width: 14px; height: 14px" />
          </button>
          <span class="tap-step-val tnum">{{ store.fontSize }}</span>
          <button
            class="tap-step"
            type="button"
            :disabled="store.fontSize >= FONT_SIZE_MAX"
            :aria-label="t('ssh.appearance.fontSizeUp')"
            @click="store.setFontSize(store.fontSize + 1)"
          >
            <Icon name="plus" style="width: 14px; height: 14px" />
          </button>
        </div>
      </div>

      <!-- Font family -->
      <div class="tap-group">
        <div class="tap-label">{{ t('ssh.appearance.fontFamily') }}</div>
        <AppSelect v-model="fontModel" :options="FONT_OPTIONS" width="100%" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Terminal appearance drawer for the SSH workspace. Right-docked over the stage;
// picks a color preset + font size + family, applied LIVE to every open xterm via
// the shared terminalAppearance store (WorkspaceTerminal watches it). Renderer-only
// state — no IPC. Closes on × and Escape.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import {
  FONT_OPTIONS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  useTerminalAppearanceStore,
  type TerminalPreset,
} from '~/stores/terminalAppearance'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useTerminalAppearanceStore()

// AppSelect needs a writable binding; route writes through the store action.
const fontModel = computed<string>({
  get: () => store.fontFamily,
  set: (v) => store.setFontFamily(v),
})

// Swatch preview colors. A concrete preset uses its own palette; the 'system'
// preset (theme === null) previews the live app theme via CSS-var tokens.
const swatchBg = (p: TerminalPreset): string => p.theme?.background ?? 'var(--bg)'
const swatchFg = (p: TerminalPreset): string => p.theme?.foreground ?? 'var(--text)'
const swatchDots = (p: TerminalPreset): string[] =>
  p.theme
    ? [p.theme.red, p.theme.green, p.theme.yellow, p.theme.blue, p.theme.magenta]
    : ['var(--accent)']

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.tap {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  border-left: 1px solid var(--border);
  background: var(--bg);
  z-index: 5;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.tap-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.tap-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.tap-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.tap-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.tap-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 14px 12px;
}
.tap-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tap-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 550;
  color: var(--textDim);
}
.tap-presets {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tap-preset {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  text-align: left;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.tap-preset:hover {
  background: var(--bgHover);
  color: var(--text);
}
.tap-preset.on {
  background: var(--bgActive);
  border-color: var(--accentBorder);
  color: var(--text);
}
.tap-swatch {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  width: 44px;
  height: 32px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  overflow: hidden;
}
.tap-swatch-txt {
  /* mono-ok: terminal preview swatch — shows real terminal text */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: 1;
}
.tap-swatch-dots {
  display: flex;
  gap: 2px;
}
.tap-swatch-dots i {
  width: 5px;
  height: 5px;
  /* design-token-ok: 5px swatch dot — a token radius clamps and changes its shape. */
  border-radius: 1px;
}
.tap-preset-name {
  flex: 1 1 auto;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
}
.tap-check {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--accent);
}
.tap-stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  padding: 2px;
}
.tap-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.tap-step:hover:not(:disabled) {
  background: var(--bgHover);
}
.tap-step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tap-step-val {
  min-width: 30px;
  text-align: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
</style>
