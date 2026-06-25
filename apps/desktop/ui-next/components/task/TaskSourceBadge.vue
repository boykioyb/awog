<template>
  <span
    v-if="source.type === 'github'"
    class="tsb"
    :class="{ link: !!source.url }"
    :title="source.url || undefined"
    role="link"
    tabindex="0"
    @click.stop="open(source.url)"
    @keydown.enter.stop="open(source.url)"
  >
    <Icon name="branch" class="tsb-icn" />
    <span class="mono">{{ source.repo }}#{{ source.issueNumber }}</span>
  </span>
  <span v-else-if="source.type === 'jira'" class="tsb">
    <Icon name="layers" class="tsb-icn" />
    <span class="mono">{{ source.key }}</span>
  </span>
  <span v-else class="tsb">
    <Icon name="text" class="tsb-icn" />
    {{ t('tasks.source.manual') }}
  </span>
</template>

<script setup lang="ts">
// Task source chip — GitHub issue/PR (clickable → OS browser), Jira key, or
// manual. Port of the old UI TaskSourceBadge in prototype CSS. Reuses the
// IconSprite glyphs (branch ≈ github, layers ≈ jira, text ≈ manual).
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import type { TaskSource } from '~/stores/tasks'

defineProps<{ source: TaskSource }>()

const { t } = useI18n()
const sc = useSidecar()

// Open the issue/PR in the OS browser; fall back to window.open in browser-dev.
const open = (url: string): void => {
  if (!url) return
  sc.openExternal(url).catch(() => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  })
}
</script>

<style scoped>
.tsb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--textMuted);
}
.tsb.link {
  cursor: pointer;
}
.tsb.link:hover {
  color: var(--text);
  text-decoration: underline;
}
.tsb-icn {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
}
.mono {
  font-family: var(--code);
}
</style>
