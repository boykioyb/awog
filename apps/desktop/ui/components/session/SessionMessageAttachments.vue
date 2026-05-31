<template>
  <div class="flex flex-wrap gap-1.5 justify-end" :style="{ maxWidth: '78%' }">
    <template v-for="att in attachments" :key="att.id">
      <button
        v-if="att.type === 'image' && att.url"
        type="button"
        class="rounded-md overflow-hidden relative group transition"
        :style="{
          width: '160px',
          height: '100px',
          border: `1px solid ${t.border}`,
          background: t.bgSubtle,
        }"
        :title="`View ${att.name}${att.size ? ` · ${att.size}` : ''}`"
        @click="emit('open', att)"
      >
        <img :src="att.url" :alt="att.name" class="w-full h-full object-cover" draggable="false" />
        <div
          class="absolute inset-x-0 bottom-0 px-2 py-1 flex items-center gap-1"
          :style="{
            background: t.overlay,
            backdropFilter: 'blur(4px)',
          }"
        >
          <span
            class="text-[1em] font-mono truncate flex-1 text-left"
            :style="{ color: t.onAccent }"
          >
            {{ att.name }}
          </span>
          <Maximize2 :size="10" :style="{ color: t.onAccent, flexShrink: 0 }" />
        </div>
      </button>
      <button
        v-else
        type="button"
        class="rounded-md flex items-center gap-2.5 px-3 text-left transition"
        :style="{
          height: '44px',
          minWidth: '180px',
          maxWidth: '260px',
          background: t.bgSubtle,
          color: t.text,
          border: `1px solid ${t.border}`,
          cursor: att.preview ? 'pointer' : 'default',
          opacity: att.preview ? 1 : 0.85,
        }"
        :disabled="!att.preview"
        :title="
          att.preview
            ? `View ${att.name}${att.size ? ` · ${att.size}` : ''}`
            : `${att.name}${att.size ? ` · ${att.size}` : ''}`
        "
        @click="emit('open', att)"
      >
        <component
          :is="fileIconFor(att.name).icon"
          :size="18"
          class="flex-shrink-0"
          :style="{ color: fileIconFor(att.name).color }"
        />
        <div class="flex-1 min-w-0">
          <div class="font-mono text-[1em] truncate" :style="{ color: t.text }">
            {{ att.name }}
          </div>
          <div
            class="text-[1em] truncate flex items-center gap-1.5"
            :style="{ color: t.textFaint }"
          >
            <span :style="{ color: fileIconFor(att.name).color, fontWeight: 500 }">
              {{ fileIconFor(att.name).label }}
            </span>
            <span v-if="att.size">· {{ att.size }}</span>
          </div>
        </div>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Maximize2 } from 'lucide-vue-next'
import type { SessionAttachment } from '~/types'
import { fileIconFor } from '~/utils/file-icon'

defineProps<{
  attachments: SessionAttachment[]
}>()

const emit = defineEmits<{
  open: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
</script>
