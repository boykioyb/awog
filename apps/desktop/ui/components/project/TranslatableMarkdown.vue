<!--
  A markdown block (issue/PR title, body, or a comment) rendered for the active
  language tab (ADR 0049). On the 'orig' tab — or while a translation is still
  loading/failed — it shows the original text; once the translation for the
  current language arrives it shows that instead. Renders via MarkdownRenderer,
  never raw v-html.
-->
<template>
  <div>
    <MarkdownRenderer :content="shown" />
    <div
      v-if="translation?.loading"
      class="text-[12px] mt-1 inline-flex items-center gap-1"
      :style="{ color: t.textDim }"
    >
      <Loader2 :size="12" class="animate-spin" />
      {{ tr('project.github.translating') }}
    </div>
    <div v-else-if="translation?.error" class="text-[12px] mt-1" :style="{ color: t.danger }">
      {{ tr('project.github.translate_failed') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { GhSegmentState, ViewLang } from '~/composables/useProjectGh'

const props = defineProps<{
  text: string
  viewLang: ViewLang
  translation: GhSegmentState | null
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

// Show the translation only on a language tab once it has arrived; otherwise the
// original (covers the 'orig' tab, in-flight, and failed cases).
const shown = computed(() =>
  props.viewLang !== 'orig' && props.translation?.translated !== undefined
    ? props.translation.translated
    : props.text,
)
</script>
