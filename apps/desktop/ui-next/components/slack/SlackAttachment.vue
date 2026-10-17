<template>
  <div v-if="files.length || unfurls.length" class="mt-1.5 flex flex-col gap-1.5">
    <div v-if="media.length" class="slk-media" :class="`n${Math.min(media.length, 4)}`">
      <Button
        v-for="f in media.slice(0, 4)"
        :key="f.id"
        variant="ghost"
        class="slk-tile"
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
        <span v-else class="slk-tile-name">{{ f.name }}</span>
        <span v-if="f.kind === 'video'" class="slk-play"><Icon name="play" /></span>
        <span v-if="media.length > 4 && f === media[3]" class="slk-more">
          +{{ media.length - 4 }}
        </span>
      </Button>
    </div>

    <div v-for="f in snippets" :key="f.id" class="slk-snippet">
      <div class="slk-snippet-hd">
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
      <pre class="slk-snippet-body">{{ f.preview }}</pre>
    </div>

    <SlackFileCard
      v-for="f in cards"
      :key="f.id"
      :file="f"
      :team-id="teamId"
      :project-id="projectId"
    />

    <div v-for="(u, i) in unfurls" :key="`u${i}`" class="slk-unfurl">
      <div v-if="u.serviceName" class="text-xs text-dim">{{ u.serviceName }}</div>
      <a
        v-if="u.url && u.title"
        :href="u.url"
        target="_blank"
        rel="noopener noreferrer"
        class="slk-unfurl-t"
      >
        {{ u.title }}
      </a>
      <div v-else-if="u.title" class="slk-unfurl-t">{{ u.title }}</div>
      <div v-if="u.text" class="slk-unfurl-x">{{ u.text }}</div>
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

<style scoped>
.slk-media {
  display: grid;
  gap: 4px;
  max-width: 420px;
}
.slk-media.n1 {
  grid-template-columns: 1fr;
}
.slk-media:not(.n1) {
  grid-template-columns: 1fr 1fr;
}
.slk-tile {
  position: relative;
  height: 140px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
}
.slk-media.n1 .slk-tile {
  height: 240px;
}
.slk-tile-name {
  padding: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: normal;
}
.slk-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text);
}
.slk-play .icn {
  width: 40px;
  height: 40px;
  padding: 10px;
  border-radius: 50%;
  background: var(--bgPanel);
  opacity: 0.9;
}
.slk-more {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  font-weight: 600;
}
.slk-snippet {
  max-width: 560px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.slk-snippet-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 2px 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  background: var(--bgSubtle);
  box-shadow: inset 0 -1px 0 var(--border);
}
.slk-snippet-body {
  /* mono-ok: nội dung snippet là code/văn bản thô người dùng copy */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin: 0;
  padding: 8px 10px;
  max-height: 240px;
  overflow: auto;
  white-space: pre;
}
.slk-unfurl {
  max-width: 520px;
  padding: 2px 0 2px 10px;
  border-left: 3px solid var(--borderStrong);
}
.slk-unfurl-t {
  display: block;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--blue);
  text-decoration: none;
}
.slk-unfurl-x {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
