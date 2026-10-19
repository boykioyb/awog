<template>
  <!-- "New" → chọn đường tạo (khuôn create-agent của Multica): hai card lớn —
       Start blank (form tay) | Build with AI (chat/draft). Hai page Agents và
       Teams dùng chung. -->
  <LibraryEntityModal :open="open" :title="title" :width="520" @close="emit('close')">
    <div class="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2">
      <Button variant="outline" :class="OPTION" @click="emit('blank')">
        <span :class="ICON_TILE">
          <Icon name="edit" />
        </span>
        <span class="text-sm font-semibold text-foreground">
          {{ t('collection.create.blank') }}
        </span>
        <span class="text-xs text-muted-foreground">{{ blankDesc }}</span>
      </Button>
      <Button variant="outline" :class="OPTION" @click="emit('ai')">
        <span :class="cn(ICON_TILE, 'border-primary/45 text-primary')">
          <Icon name="sparkles" />
        </span>
        <span class="text-sm font-semibold text-foreground">{{ t('collection.create.ai') }}</span>
        <span class="text-xs text-muted-foreground">{{ aiDesc }}</span>
      </Button>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
import { cn } from '~/lib/utils'
import Icon from '~/components/Icon.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useI18n } from '~/composables/useI18n'

defineProps<{
  open: boolean
  title: string
  blankDesc: string
  aiDesc: string
}>()

const emit = defineEmits<{ close: []; blank: []; ai: [] }>()
const { t } = useI18n()

// Card lựa chọn: cả khối là một nút, chữ trái-trên, hover nhấn viền ring + bóng nhẹ.
const OPTION =
  'h-auto flex-col items-start justify-start gap-2 whitespace-normal p-3.5 text-left font-normal shadow-none hover:border-ring hover:bg-transparent hover:shadow-sm [&_svg]:size-4.5'
const ICON_TILE =
  'inline-flex size-8 items-center justify-center rounded-md border bg-muted text-muted-foreground'
</script>
