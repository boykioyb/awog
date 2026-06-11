<template>
  <BaseModal :open="open" size="lg" @close="emit('close')">
    <template #header>
      <Sparkles :size="15" :style="{ color: t.accent }" />
      <div class="text-[1em] font-medium" :style="{ color: t.text }">
        {{ tr('whatsnew.title') }}
      </div>
    </template>

    <div class="px-4 py-3 space-y-7">
      <section v-for="rel in releases" :key="rel.version" class="space-y-2.5">
        <header class="flex items-baseline gap-2">
          <span class="text-[1em] font-semibold" :style="{ color: t.text }">
            v{{ rel.version }}
          </span>
          <span class="text-[12px] font-mono leading-none" :style="{ color: t.textDim }">
            {{ rel.date }}
          </span>
        </header>

        <p v-if="rel.highlight" class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ pick(rel.highlight) }}
        </p>

        <!-- Grid keeps every body text aligned to one column: the badge column
             auto-sizes to the widest label (e.g. "Improved"/"Thay đổi"), so rows
             no longer start at a ragged left edge regardless of locale. -->
        <ul
          class="grid items-start justify-items-start gap-x-2.5 gap-y-1.5 text-[1em] leading-relaxed"
          style="grid-template-columns: max-content 1fr"
        >
          <li v-for="(item, i) in rel.items" :key="i" class="contents">
            <span
              class="mt-0.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[12px] font-medium leading-none"
              :style="kindStyle(item.kind)"
            >
              {{ tr(`whatsnew.kind.${item.kind}`) }}
            </span>
            <span :style="{ color: t.text }">{{ pick(item) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </BaseModal>
</template>

<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import type { ChangeKind, LocalizedText, Release } from '~/utils/changelog'
import type { ThemeTokens } from '~/utils/themes'

defineProps<{ open: boolean; releases: Release[] }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr, locale } = useI18n()

const pick = (text: LocalizedText) => (locale.value === 'vi' ? text.vi : text.en)

// Each change kind maps to a theme accent so the badge reads at a glance.
// `bgInput` keeps the pill subtle in both light and dark themes; only the text
// carries the color. `as const` keeps the lookup string-typed (ThemeTokens has
// a non-string `syntax` member that a bare `keyof` would otherwise widen in).
const KIND_COLOR = {
  added: 'success',
  improved: 'accent',
  changed: 'warning',
  fixed: 'info',
} as const satisfies Record<ChangeKind, keyof ThemeTokens>

const kindStyle = (kind: ChangeKind) => ({
  background: t.value.bgInput,
  color: t.value[KIND_COLOR[kind]],
  border: `1px solid ${t.value.border}`,
})
</script>
