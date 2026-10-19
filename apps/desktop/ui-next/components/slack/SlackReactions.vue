<template>
  <div class="flex flex-wrap items-center gap-1">
    <Tooltip v-for="r in reactions" :key="r.name">
      <TooltipTrigger as-child>
        <Button
          variant="outline"
          size="xs"
          class="h-6 gap-1 rounded-full px-1.5 text-xs"
          :class="{ 'border-selected-border bg-selected text-primary': r.mine }"
          :aria-pressed="r.mine"
          @click="emit('toggle', r.name)"
        >
          <SlackEmoji :name="r.name" :custom-url="customUrl" />
          <span class="tnum">{{ r.count }}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ whoReacted(r) }}</TooltipContent>
    </Tooltip>
    <SlackEmojiPicker :team-id="teamId" :custom-url="customUrl" @pick="(n) => emit('add', n)">
      <Button variant="ghost" size="iconSm" class="text-dim" :title="t('slack.message.react')">
        <Icon name="smile" />
      </Button>
    </SlackEmojiPicker>
  </div>
</template>

<script setup lang="ts">
// Chip reaction dưới một tin: bấm để react theo / bỏ react của mình, hover thấy ai đã
// react. Chip mình đã react viền accent (như Slack).
import type { SlackReaction } from '~/stores/slack'

const props = defineProps<{
  reactions: SlackReaction[]
  teamId: string
  customUrl: (name: string) => string | null
  userName: (id: string) => string | null
}>()
const emit = defineEmits<{ toggle: [name: string]; add: [name: string] }>()

const { t } = useI18n()

// `users` của Slack có thể ít hơn `count` (Slack cắt danh sách) — phần dư ghi "+N".
function whoReacted(r: SlackReaction): string {
  const names = r.users.map((id) => props.userName(id) ?? id)
  const extra = r.count - names.length
  const list = names.join(', ')
  return `${extra > 0 ? t('slack.reaction.whoMore', { names: list, n: extra }) : list} — :${r.name}:`
}
</script>
