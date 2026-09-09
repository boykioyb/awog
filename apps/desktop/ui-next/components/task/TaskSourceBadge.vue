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
  <span
    v-else-if="source.type === 'session'"
    class="tsb link"
    :title="t('tasks.source.session')"
    role="link"
    tabindex="0"
    @click.stop="openSession(source.sessionId)"
    @keydown.enter.stop="openSession(source.sessionId)"
  >
    <Icon name="sessions" class="tsb-icn" />
    {{ t('tasks.source.session') }}
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
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import type { TaskSource } from '~/stores/tasks'

defineProps<{ source: TaskSource }>()

const { t } = useI18n()
const { openSession } = useSessionTaskLink()

// The issue/PR behind this task — through the shared chooser (in-app browser or
// OS browser), which handles the browser-dev fallback itself.
const open = (url: string): void => {
  if (url) void useLinkOpen().openLink(url)
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
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
</style>
