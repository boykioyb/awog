<template>
  <!-- Thanh nổi Quote/Translate/Copy-MD khi bôi đen text trong feed của thread board /
       kênh — cùng bộ ba `.selactions` của SessionDetail. z 80 đủ: thread sống TRONG
       stacking context của overlay editor (160) nên so với nội dung modal nó vẫn nổi
       trên — fixed chỉ tranh z trong cùng context. `mousedown.prevent` giữ nguyên
       vùng chọn khi bấm nút. -->
  <div
    class="fixed top-0 left-0 z-80 inline-flex max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    :style="{ transform }"
    @mousedown.prevent
  >
    <Button
      variant="ghost"
      size="xs"
      class="gap-1.5 font-normal [&_svg]:size-3.5"
      @click="emit('quote')"
    >
      <Icon name="quote" />
      {{ t('sessions.quote.action') }}
    </Button>
    <Button
      variant="ghost"
      size="xs"
      class="gap-1.5 font-normal [&_svg]:size-3.5"
      @click="emit('translate')"
    >
      <Icon name="globe" />
      {{ t('translate.action') }}
    </Button>
    <Button
      variant="ghost"
      size="xs"
      class="gap-1.5 font-normal [&_svg]:size-3.5"
      @click="emit('copy-md')"
    >
      <Icon :name="copied ? 'check' : 'copy'" />
      {{ copied ? t('common.copied') : t('common.copyMarkdown') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Thanh nổi bôi-đen dùng chung cho WorkspaceBoardThread + WorkspaceChannelThread
// (trước là hai bản sao `.btsel` scoped CSS). Chỉ trình bày — vị trí + hành động do
// thread cha giữ.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  // Toạ độ viewport của điểm neo (giữa-trên vùng chọn, hoặc con trỏ chuột phải).
  x: number
  y: number
  copied: boolean
}>()
const emit = defineEmits<{ quote: []; translate: []; 'copy-md': [] }>()
const { t } = useI18n()

// Căn giữa theo x, nằm trên điểm neo; kẹp trong viewport cách mép 8px.
const transform = computed(
  () =>
    `translate(clamp(8px, calc(${props.x}px - 50%), calc(100vw - 100% - 8px)), max(8px, calc(${props.y}px - 100%)))`,
)
</script>
