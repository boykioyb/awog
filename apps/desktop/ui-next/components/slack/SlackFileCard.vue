<template>
  <div class="slk-fcard" :class="{ off: !!file.unavailable && !isExternal }">
    <span class="slk-fic"><Icon :name="icon" /></span>
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

<style scoped>
.slk-fcard {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
}
.slk-fcard.off {
  background: var(--bgSubtle);
  color: var(--textDim);
}
.slk-fic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-xs);
  background: var(--accentDim);
  color: var(--accent);
}
.slk-fcard.off .slk-fic {
  background: var(--bgHover);
  color: var(--textFaint);
}
</style>
