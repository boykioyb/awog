<template>
  <span
    v-if="source.type === 'github'"
    class="inline-flex items-center gap-1.5 text-muted-foreground"
    :class="{ 'cursor-pointer hover:text-foreground hover:underline': !!source.url }"
    :title="source.url || undefined"
    role="link"
    tabindex="0"
    @click.stop="open(source.url)"
    @keydown.enter.stop="open(source.url)"
  >
    <Icon name="branch" class="size-3 shrink-0" />
    <span class="font-mono">{{ source.repo }}#{{ source.issueNumber }}</span>
  </span>
  <span
    v-else-if="source.type === 'jira'"
    class="inline-flex items-center gap-1.5 text-muted-foreground"
  >
    <Icon name="layers" class="size-3 shrink-0" />
    <span class="font-mono">{{ source.key }}</span>
  </span>
  <span
    v-else-if="source.type === 'session'"
    class="inline-flex items-center gap-1.5 text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
    :title="t('tasks.source.session')"
    role="link"
    tabindex="0"
    @click.stop="openSession(source.sessionId)"
    @keydown.enter.stop="openSession(source.sessionId)"
  >
    <Icon name="sessions" class="size-3 shrink-0" />
    {{ t('tasks.source.session') }}
  </span>
  <span v-else class="inline-flex items-center gap-1.5 text-muted-foreground">
    <Icon name="text" class="size-3 shrink-0" />
    {{ t('tasks.source.manual') }}
  </span>
</template>

<script setup lang="ts">
// Task source chip — GitHub issue/PR (clickable → OS browser), Jira key, or
// manual. Reuses the
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
