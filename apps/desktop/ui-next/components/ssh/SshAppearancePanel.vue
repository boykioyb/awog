<template>
  <div
    class="absolute inset-y-0 right-0 z-5 flex w-80 flex-col overflow-y-auto border-l bg-background"
    role="dialog"
    :aria-label="t('ssh.appearance.title')"
  >
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5">
      <span class="text-sm font-medium text-foreground">{{ t('ssh.appearance.title') }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :title="t('ssh.appearance.close')"
        :aria-label="t('ssh.appearance.close')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </div>
    <Separator />

    <div class="flex min-h-0 flex-auto flex-col gap-4.5 px-3 py-3.5">
      <!-- Theme preset -->
      <div class="flex flex-col gap-2">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('ssh.appearance.theme') }}
        </div>
        <div class="flex flex-col gap-1">
          <Button
            v-for="p in store.presets"
            :key="p.id"
            variant="ghost"
            class="h-auto justify-start gap-2.5 border border-transparent px-2 py-1.5 text-left font-normal text-muted-foreground"
            :class="{
              'border-selected-border bg-selected text-foreground hover:bg-selected':
                p.id === store.presetId,
            }"
            @click="store.setPreset(p.id)"
          >
            <!-- Swatch xem trước màu terminal của preset — màu lấy từ dữ liệu preset. -->
            <span
              class="flex h-8 w-11 shrink-0 flex-col items-start justify-center gap-0.5 overflow-hidden rounded-sm border px-1 py-0.5"
              :style="{ background: swatchBg(p) }"
            >
              <span class="font-mono text-xs" :style="{ color: swatchFg(p) }">Aa</span>
              <span class="flex gap-0.5">
                <i
                  v-for="(c, i) in swatchDots(p)"
                  :key="i"
                  class="size-1.25 rounded-xs"
                  :style="{ background: c }"
                />
              </span>
            </span>
            <span class="flex-auto text-sm font-medium">{{ p.name }}</span>
            <Icon v-if="p.id === store.presetId" name="check" class="shrink-0 text-primary" />
          </Button>
        </div>
      </div>

      <!-- Font size -->
      <div class="flex flex-col gap-2">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('ssh.appearance.fontSize') }}
        </div>
        <div class="inline-flex items-center gap-0.5 self-start rounded-md border bg-muted p-0.5">
          <Button
            variant="ghost"
            size="iconSm"
            :disabled="store.fontSize <= FONT_SIZE_MIN"
            :aria-label="t('ssh.appearance.fontSizeDown')"
            @click="store.setFontSize(store.fontSize - 1)"
          >
            <Icon name="minus" />
          </Button>
          <span class="min-w-7.5 text-center text-sm text-foreground tabular-nums">
            {{ store.fontSize }}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            :disabled="store.fontSize >= FONT_SIZE_MAX"
            :aria-label="t('ssh.appearance.fontSizeUp')"
            @click="store.setFontSize(store.fontSize + 1)"
          >
            <Icon name="plus" />
          </Button>
        </div>
      </div>

      <!-- Font family -->
      <div class="flex flex-col gap-2">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('ssh.appearance.fontFamily') }}
        </div>
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
