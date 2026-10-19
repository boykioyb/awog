<template>
  <div v-if="files.length || unfurls.length" class="mt-1.5 flex flex-col gap-1.5">
    <div
      v-if="media.length"
      class="grid max-w-105 gap-1"
      :class="media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
    >
      <Button
        v-for="f in media.slice(0, 4)"
        :key="f.id"
        variant="ghost"
        class="relative overflow-hidden rounded-md border bg-muted p-0"
        :class="media.length === 1 ? 'h-60' : 'h-35'"
        :title="f.name"
        @click="actions.open(teamId, f)"
      >
        <SlackThumb
          v-if="f.thumb"
          :team-id="teamId"
          :file-id="f.id"
          :size="media.length === 1 ? 720 : 360"
          :alt="f.name"
        />
        <span v-else class="whitespace-normal p-2 text-xs text-dim">{{ f.name }}</span>
        <span
          v-if="f.kind === 'video'"
          class="absolute inset-0 grid place-items-center text-foreground"
        >
          <Icon name="play" class="size-10! rounded-full bg-sidebar p-2.5 opacity-90" />
        </span>
        <span
          v-if="media.length > 4 && f === media[3]"
          class="absolute inset-0 grid place-items-center bg-background/60 text-xl font-semibold"
        >
          +{{ media.length - 4 }}
        </span>
      </Button>
    </div>

    <div v-for="f in snippets" :key="f.id" class="max-w-140 overflow-hidden rounded-md border">
      <div
        class="flex items-center justify-between gap-2 border-b bg-muted py-0.5 pl-2.5 pr-1 text-xs text-dim"
      >
        <span class="truncate">{{ f.title || f.name }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('slack.file.view')"
          @click="actions.open(teamId, f)"
        >
          <Icon name="eye" />
        </Button>
      </div>
      <!-- mono-ok: nội dung snippet là code/văn bản thô người dùng copy -->
      <pre class="m-0 max-h-60 overflow-auto whitespace-pre px-2.5 py-2 font-mono text-sm">{{
        f.preview
      }}</pre>
    </div>

    <SlackFileCard
      v-for="f in cards"
      :key="f.id"
      :file="f"
      :team-id="teamId"
      :project-id="projectId"
    />

    <div
      v-for="(u, i) in unfurls"
      :key="`u${i}`"
      class="max-w-130 border-l-3 border-input py-0.5 pl-2.5"
    >
      <div v-if="u.serviceName" class="text-xs text-dim">{{ u.serviceName }}</div>
      <a
        v-if="u.url && u.title"
        :href="u.url"
        target="_blank"
        rel="noopener noreferrer"
        class="block text-base font-semibold text-info no-underline"
      >
        {{ u.title }}
      </a>
      <div v-else-if="u.title" class="block text-base font-semibold text-info">{{ u.title }}</div>
      <div v-if="u.text" class="line-clamp-4 whitespace-pre-wrap text-sm text-dim">
        {{ u.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Đính kèm của một tin: lưới ảnh/video 1–4 ô (bấm để xem), snippet dạng khối code, thẻ
// file cho loại còn lại, và thẻ unfurl. Ảnh xem trước của unfurl (`imageUrl`) cố ý KHÔNG
// tải: đó là URL bên thứ ba, renderer gọi thẳng là rò thông tin ra ngoài (invariant #5).
import { computed } from 'vue'
import { useSlackFiles } from '~/composables/useSlackFiles'
import type { SlackFile, SlackUnfurl } from '~/stores/slack'

const props = defineProps<{
  files: SlackFile[]
  unfurls: SlackUnfurl[]
  teamId: string
  projectId: string | null
}>()

const { t } = useI18n()
const actions = useSlackFiles()

const isMedia = (f: SlackFile): boolean =>
  !f.unavailable && (f.kind === 'image' || f.kind === 'video')
const media = computed(() => props.files.filter(isMedia))
const snippets = computed(() =>
  props.files.filter((f) => !f.unavailable && f.kind === 'snippet' && f.preview),
)
const cards = computed(() => props.files.filter((f) => !isMedia(f) && !snippets.value.includes(f)))
</script>
