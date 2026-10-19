<template>
  <Dialog :open="pushOpen" @update:open="(v) => !v && close()">
    <DialogContent
      class="flex max-h-[calc(100vh-48px)] w-full max-w-170 flex-col gap-0 overflow-hidden border-input bg-sidebar p-0 sm:max-w-170 sm:rounded-2xl"
      :aria-label="t('logtime.push.title')"
    >
      <DialogHeader class="flex-none border-b px-4 py-3 pr-12">
        <DialogTitle class="text-lg font-semibold">
          {{ done ? t('logtime.push.done') : t('logtime.push.title') }}
        </DialogTitle>
        <DialogDescription class="text-xs text-dim">
          {{ t('logtime.push.sub', { n: pushableDrafts.length, h: fmt(pushableHours) }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        <!-- Cảnh báo thao tác RA NGOÀI: PMS là hệ thống thật của công ty. -->
        <div
          v-if="!done"
          class="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-muted-foreground"
        >
          <Icon name="alert" class="size-3.5 shrink-0 text-warning" />
          <span>{{ t('logtime.push.warn') }}</span>
        </div>
        <div
          v-else
          class="flex items-start gap-2 rounded-lg border border-selected-border bg-selected px-3 py-2.5 text-sm text-muted-foreground"
        >
          <Icon name="check" class="size-3.5 shrink-0 text-primary" />
          <span>{{ t('logtime.push.okNote', { n: okCount }) }}</span>
        </div>

        <div
          v-if="blockedDrafts.length > 0"
          class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-muted-foreground"
        >
          <Icon name="alert" class="size-3.5 shrink-0 text-destructive" />
          <span>{{ t('logtime.push.blocked', { n: blockedDrafts.length }) }}</span>
        </div>

        <!-- Từng dòng sẽ gửi, gom theo nguồn -->
        <div
          v-for="group in groups"
          :key="group.sourceId"
          class="overflow-hidden rounded-lg border"
        >
          <div class="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2">
            <span class="text-base font-semibold">{{ group.name }}</span>
            <!-- URL endpoint MCP, người dùng copy được ⇒ mono hợp lệ. -->
            <span class="font-mono text-xs break-all text-faint">{{ group.url }}</span>
            <span class="flex-1" />
            <Badge variant="outline" class="rounded-sm text-muted-foreground tabular-nums">
              {{ group.entries.length }} · {{ fmt(group.hours) }}h
            </Badge>
          </div>
          <div
            v-for="entry in group.entries"
            :key="entry.id"
            class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
          >
            <span class="min-w-0 truncate">{{ labelOf(entry.projectKey) }} — {{ entry.note }}</span>
            <span class="tabular-nums text-dim">{{ fmt(entry.hours) }}h</span>
            <span>
              <Badge
                v-if="resultOf(entry.id)?.ok"
                variant="outline"
                class="rounded-sm border-primary/40 bg-primary/10 text-primary"
              >
                <Icon name="check" />
                {{ shortId(resultOf(entry.id)?.worklogId) }}
              </Badge>
              <Badge
                v-else-if="resultOf(entry.id)"
                variant="outline"
                class="rounded-sm border-destructive/40 text-destructive"
                :title="resultOf(entry.id)?.error"
              >
                <Icon name="alert" />
                {{ t('logtime.push.failed') }}
              </Badge>
              <Badge v-else-if="pushing" variant="outline" class="rounded-sm text-muted-foreground">
                {{ t('logtime.push.sending') }}
              </Badge>
              <Badge v-else variant="outline" class="rounded-sm text-muted-foreground">
                {{ t('logtime.push.ready') }}
              </Badge>
            </span>
          </div>
        </div>

        <!-- Payload dòng đầu: nhìn thấy đúng thứ sắp bay đi (JSON copy được ⇒ mono). -->
        <template v-if="!done && firstPayload">
          <div class="text-xs font-semibold text-dim">{{ t('logtime.push.payload') }}</div>
          <pre
            class="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-sm leading-relaxed text-muted-foreground"
            >{{ firstPayload }}</pre
          >
        </template>

        <!-- Ô xác nhận: nút chỉ mở khoá khi người dùng tự tích -->
        <label
          v-if="!done"
          class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-muted px-3 py-3 text-sm text-muted-foreground"
        >
          <Checkbox
            class="mt-0.5"
            :model-value="pushConfirmed"
            @update:model-value="pushConfirmed = $event === true"
          />
          <span>
            {{ t('logtime.push.confirm', { n: pushableDrafts.length, h: fmt(pushableHours) }) }}
          </span>
        </label>
      </div>

      <div class="flex flex-none flex-wrap items-center gap-2 border-t px-4 py-3">
        <span class="text-xs text-dim">
          {{ done ? t('logtime.push.hintDone') : t('logtime.push.hint') }}
        </span>
        <span class="flex-1" />
        <Button type="button" variant="outline" @click="close">
          {{ done ? t('common.close') : t('common.cancel') }}
        </Button>
        <Button
          v-if="!done"
          type="button"
          :disabled="!pushConfirmed || pushing || pushableDrafts.length === 0"
          variant="default"
          @click="runPush"
        >
          {{ t('logtime.push.go', { n: pushableDrafts.length }) }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Hộp thoại đẩy — hai bước (xem lại → tích ô → gửi), ADR 0091 D-5. Chưa gọi gì
// lên PMS cho tới khi bấm nút cuối.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import type { LogtimeEntry } from '~/stores/logtime'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const {
  store,
  date,
  pushOpen,
  pushConfirmed,
  pushResults,
  pushing,
  pushableDrafts,
  blockedDrafts,
  fmt,
  labelOf,
  runPush,
} = useLogtimeManager()

const done = computed(() => pushResults.value.length > 0 && !pushing.value)
const okCount = computed(() => pushResults.value.filter((r) => r.ok).length)
const pushableHours = computed(() => pushableDrafts.value.reduce((s, e) => s + e.hours, 0))

const groups = computed(() => {
  const out = new Map<
    string,
    { sourceId: string; name: string; url: string; entries: LogtimeEntry[]; hours: number }
  >()
  for (const entry of pushableDrafts.value) {
    const link = store.linkOf(entry.projectKey)
    if (!link) continue
    const cap = store.capabilities.find((c) => c.sourceId === link.sourceId)
    const group = out.get(link.sourceId) ?? {
      sourceId: link.sourceId,
      name: cap?.name ?? link.sourceId,
      url: cap?.url ?? '',
      entries: [],
      hours: 0,
    }
    group.entries.push(entry)
    group.hours += entry.hours
    out.set(link.sourceId, group)
  }
  return [...out.values()]
})

const resultOf = (id: string) => pushResults.value.find((r) => r.entryId === id)

const shortId = (id: string | undefined): string => (id ? `${id.slice(0, 8)}…` : '')

// Payload thật của dòng đầu — cùng shape với lời gọi `worklog_create` ở sidecar.
const firstPayload = computed(() => {
  const entry = pushableDrafts.value[0]
  if (!entry) return ''
  const link = store.linkOf(entry.projectKey)
  if (!link) return ''
  const url =
    link.githubRepo && entry.task?.issue
      ? `https://github.com/${link.githubRepo}/issues/${entry.task.issue}`
      : null
  return JSON.stringify(
    {
      tool: 'worklog_create',
      source: link.sourceId,
      projectId: link.pmsProjectId,
      date: date.value,
      hours: entry.hours,
      note: entry.note,
      taskIds: entry.task?.id ? [entry.task.id] : [],
      githubIssueUrls: url ? [url] : [],
    },
    null,
    2,
  )
})

function close(): void {
  pushOpen.value = false
}
</script>
