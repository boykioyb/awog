<template>
  <div class="flex items-center gap-2 border-b px-4 py-3">
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1.5">
        <Input
          v-if="editing"
          ref="titleRef"
          v-model="titleDraft"
          class="h-ctrl-xs text-lg font-semibold"
          :placeholder="thread.firstLine"
          @keydown.enter.prevent="commit"
          @keydown.esc.prevent="editing = false"
          @blur="commit"
        />
        <template v-else>
          <h2 class="m-0 truncate text-xl font-semibold" :title="title">{{ title }}</h2>
          <Button
            variant="ghost"
            size="iconSm"
            :title="t('slack.thread.rename')"
            @click="startEdit"
          >
            <Icon name="edit" />
          </Button>
        </template>
      </div>
      <!-- Dòng phụ: kênh · workspace · project gắn với thread (trước nằm ở thanh dưới,
           dời lên đây để khung đọc không mất một hàng). -->
      <div class="flex min-w-0 items-center gap-2 text-xs text-dim">
        <span class="truncate">#{{ thread.channelName }} · {{ thread.teamName }}</span>
        <AppSelect
          v-model="ctx.threadProject.value"
          :options="ctx.assignOptions.value"
          size="sm"
          variant="ghost"
          width="auto"
          class="max-w-60"
          searchable
          :search-placeholder="t('slack.filter.searchProject')"
        />
        <span v-if="ctx.sessionBusy.value" class="shrink-0" role="status">
          {{ t('slack.session.busy') }}
        </span>
        <span v-else-if="thread.sessionId && ctx.newReplyCount.value" class="shrink-0">
          {{ t('slack.session.newReplies', { n: ctx.newReplyCount.value }) }}
        </span>
      </div>
    </div>
    <!-- Nút shadcn dùng chung (không skin riêng): Tabs cho Bản gốc | Bản dịch, Button
         icon cho Làm mới / Mở trong Slack. -->
    <div class="flex shrink-0 items-center gap-1.5">
      <!-- Bản gốc | Bản dịch: chọn "Bản dịch" = dịch cả thread (chỉ dịch khi được yêu cầu). -->
      <Tabs v-model="viewMode">
        <TabsList :aria-label="t('slack.thread.viewMode')">
          <TabsTrigger value="original">{{ t('slack.thread.viewOriginal') }}</TabsTrigger>
          <TabsTrigger value="translated" :title="t('slack.thread.showTranslation')">
            <Icon name="globe" />
            {{ t('slack.thread.viewTranslated') }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        variant="outline"
        size="iconMd"
        :title="t('slack.thread.refresh')"
        :aria-label="t('slack.thread.refresh')"
        :disabled="ctx.store.detailLoading"
        @click="ctx.reloadSelected"
      >
        <Icon name="refresh" :class="{ 'animate-spin': ctx.store.detailLoading }" />
      </Button>
      <Button
        variant="outline"
        size="iconMd"
        :title="t('slack.thread.openInSlack')"
        :aria-label="t('slack.thread.openInSlack')"
        @click="ctx.openInSlack"
      >
        <Icon name="external" />
      </Button>
      <SlackThreadMenu :thread="thread" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Đầu khung thread: tiêu đề (bút chì để đặt tên tại chỗ; xoá trống = quay về dòng đầu
// tin gốc), dòng phụ #kênh · workspace · project, Tabs Bản gốc | Bản dịch, 2 nút icon
// Làm mới / Mở trong Slack và menu "…" (SlackThreadMenu) — toàn bộ là component shadcn.
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useSlackCtx } from '~/composables/useSlackManager'
import { threadTitle } from '~/composables/useSlackTree'
import type { SlackThread } from '~/stores/slack'

const props = defineProps<{ thread: SlackThread }>()

const { t } = useI18n()
const ctx = useSlackCtx()
const title = computed(() => threadTitle(props.thread) || t('slack.thread.untitled'))
// Tabs ↔ trạng thái dịch chung: toggleThread() LẬT trạng thái, nên chỉ gọi khi giá trị
// mới khác hiện tại (chọn lại tab đang chọn không lật mất).
const viewMode = computed({
  get: () => (ctx.translation.showOriginal.value ? 'original' : 'translated'),
  set: (v: string) => {
    if ((v === 'original') !== ctx.translation.showOriginal.value) ctx.translation.toggleThread()
  },
})

const editing = ref(false)
const titleDraft = ref('')
const titleRef = useTemplateRef<{ focus: () => void; select: () => void }>('titleRef')

async function startEdit(): Promise<void> {
  titleDraft.value = props.thread.title ?? ''
  editing.value = true
  await nextTick()
  titleRef.value?.focus()
  titleRef.value?.select()
}

function commit(): void {
  if (!editing.value) return
  editing.value = false
  void ctx.rename(titleDraft.value)
}
</script>
