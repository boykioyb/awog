<template>
  <div
    v-if="problem"
    class="flex items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground"
    role="status"
  >
    <Icon name="warn" class="flex-none text-warning" />
    <div class="min-w-0 flex-1">
      <div class="font-medium">{{ problem.title }}</div>
      <div class="text-xs">{{ problem.body }}</div>
    </div>
    <Button v-if="!isWindow" variant="outline" size="sm" @click="openSources">
      {{ t('slack.status.openSources') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Báo trạng thái nguồn Slack: chưa có nguồn, mất kết nối (token hết hạn — không có
// refresh token nên phải kết nối lại), hoặc thiếu scope `files:read`
// (tính năng xuống cấp chứ không hỏng — ADR 0107 D-1).
import { computed } from 'vue'
import type { SlackStatus } from '~/stores/slack'
import { useSlackModal } from '~/composables/useSlackModal'

const props = defineProps<{ status: SlackStatus | null; isWindow: boolean }>()

// Trong modal: đóng modal rồi mới sang Sources, nếu không modal che mất trang đó.
function openSources(): void {
  useSlackModal().close()
  void navigateTo('/connections')
}

const { t } = useI18n()

const problem = computed<{ title: string; body: string } | null>(() => {
  const s = props.status
  if (!s) return null
  if (!s.sources.length)
    return { title: t('slack.status.noSource'), body: t('slack.status.noSourceBody') }
  const down = s.sources.find((x) => !x.connected)
  if (down) {
    return {
      title: t('slack.status.disconnected', { team: down.teamName ?? down.sourceId }),
      body: t('slack.status.reconnectBody'),
    }
  }
  const missing = [...new Set(s.sources.flatMap((x) => x.missingScopes))]
  if (missing.length) {
    return {
      title: t('slack.status.missingScopes', { scopes: missing.join(', ') }),
      body: t('slack.status.scopesBody'),
    }
  }
  return null
})
</script>
