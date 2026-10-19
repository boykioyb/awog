<template>
  <div
    class="flex max-w-105 items-center gap-2.5 rounded-md border px-2.5 py-2"
    :class="isOff ? 'bg-muted text-dim' : 'bg-sidebar'"
  >
    <span
      class="grid size-8 place-items-center rounded-sm"
      :class="isOff ? 'bg-accent text-faint' : 'bg-selected text-primary'"
    >
      <Icon :name="icon" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium" :title="file.name">
        {{ file.title || file.name }}
      </div>
      <div class="truncate text-xs text-dim">
        {{ file.unavailable ? t(`slack.file.unavailable.${file.unavailable}`) : meta }}
        <template v-if="externalHost">· {{ externalHost }}</template>
      </div>
    </div>
    <Button
      v-if="isExternal && externalHost"
      variant="ghost"
      size="iconSm"
      :title="t('slack.file.externalOpen')"
      @click="files.openExternal(file)"
    >
      <Icon name="external" />
    </Button>
    <template v-if="!file.unavailable">
      <Button
        v-if="canPreview"
        variant="ghost"
        size="iconSm"
        :disabled="files.isBusy(file)"
        :title="t('slack.file.view')"
        @click="files.open(teamId, file)"
      >
        <Icon name="eye" />
      </Button>
      <Button
        v-if="files.hasBridge"
        variant="ghost"
        size="iconSm"
        :disabled="files.isBusy(file)"
        :title="t('slack.file.download')"
        @click="files.download(teamId, file)"
      >
        <Icon name="download" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="iconSm" :title="t('slack.file.more')">
            <Icon name="dots" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-slack-overlay align="end">
          <DropdownMenuItem
            :disabled="!projectId"
            @select="projectId && files.saveToProject(teamId, file, projectId)"
          >
            <Icon name="folder" />
            {{ projectId ? t('slack.file.saveToProject') : t('slack.file.saveNeedsProject') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="files.hasBridge" @select="files.openDefault(teamId, file)">
            <Icon name="external" />
            {{ t('slack.file.openDefault') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </div>
</template>

<script setup lang="ts">
// Thẻ file đính kèm (pdf, office, text, audio, khác): icon + tên + dung lượng + Xem /
// Tải / menu (Lưu vào project, Mở bằng app mặc định). File không còn dùng được
// (`unavailable`) thì thành thẻ xám nêu lý do, không có nút. File bên ngoài (`external`:
// app khác đặt URL, AWOG không tải) thì nêu host + một nút mở link có xác nhận.
import { computed } from 'vue'
import { formatBytes } from '~/utils/format-bytes'
import { canPreviewSlackFile, useSlackFiles } from '~/composables/useSlackFiles'
import type { SlackFile } from '~/stores/slack'

const props = defineProps<{ file: SlackFile; teamId: string; projectId: string | null }>()

const { t } = useI18n()
const files = useSlackFiles()
const canPreview = computed(() => canPreviewSlackFile(props.file))
const isExternal = computed(() => props.file.unavailable === 'external')
// Thẻ xám: file không còn dùng được (trừ file bên ngoài — vẫn mở link được).
const isOff = computed(() => !!props.file.unavailable && !isExternal.value)
// Chỉ http(s) mới có host để hiện + nút mở; scheme khác coi như không có link.
const externalHost = computed(() => {
  const url = isExternal.value ? props.file.externalUrl : null
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
})
const icon = computed(() => {
  if (isExternal.value) return 'link'
  return props.file.unavailable ? 'alert' : 'file'
})
const meta = computed(() =>
  [props.file.filetype.toUpperCase(), formatBytes(props.file.size)].filter(Boolean).join(' · '),
)
</script>
