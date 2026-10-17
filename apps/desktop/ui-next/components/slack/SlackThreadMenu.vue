<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="iconMd"
        :title="t('slack.thread.more')"
        :aria-label="t('slack.thread.more')"
      >
        <Icon name="dots" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-slack-overlay align="end" side="bottom">
      <!-- Bận (đang mở / đang đưa vào phiên) ⇒ khoá cả hai mục: bấm lần hai là tạo
           phiên thứ hai / giao khối hai lần. -->
      <DropdownMenuItem
        v-if="!thread.sessionId"
        :disabled="ctx.sessionBusy.value"
        @select="ctx.openSession"
      >
        <Icon name="sessions" />
        {{ t('slack.session.open') }}
      </DropdownMenuItem>
      <template v-else>
        <DropdownMenuItem :disabled="ctx.sessionBusy.value" @select="ctx.openSession">
          <Icon name="sessions" />
          {{ t('slack.session.openLinked') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!ctx.newForSession.value || ctx.sessionBusy.value"
          @select="ctx.pushToSession"
        >
          <Icon name="forward" />
          {{ t('slack.session.push', { n: ctx.newReplyCount.value }) }}
        </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="ctx.markRead">
        <Icon name="check" />
        {{ t('slack.thread.markRead') }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="ctx.copyLink">
        <Icon name="link" />
        {{ t('slack.thread.copyLink') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="text-destructive" @select="ctx.removeThread">
        <Icon name="trash" />
        {{ t('slack.thread.remove') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
// Menu "…" ở đầu khung thread: session (mở / đưa reply mới vào), đánh dấu đã đọc,
// copy link, gỡ thread. Session đi qua useSlackSession — trong cửa sổ Slack riêng,
// lớp session tự chuyển sang cửa sổ chính.
import { useSlackCtx } from '~/composables/useSlackManager'
import type { SlackThread } from '~/stores/slack'

defineProps<{ thread: SlackThread }>()

const { t } = useI18n()
const ctx = useSlackCtx()
</script>
