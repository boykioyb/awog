<template>
  <!-- Hộp chọn đích của "Hỏi agent" — yêu cầu người dùng: "các phần hỏi agent đều
       có option là cho vào session hiện tại hay mở session mới".
       Một host duy nhất cho MỌI màn (Tổng quan · Logs · Explorer · Nhật ký ·
       Kubernetes), vì bốn bản sao của hộp này là bốn chỗ để "phiên mới" hiểu khác
       nhau về việc nó nên rơi vào project nào.
       shadcn Dialog (role=dialog ⇒ OVERLAYS đã phủ). Esc / bấm ngoài / X = đóng: hộp
       này là một quyết định, không phải một bước bắt buộc. -->
  <Dialog :open="chooser.open" @update:open="(v: boolean) => !v && closeChooser()">
    <DialogContent
      class="flex w-[min(32.5rem,calc(100vw-2rem))] flex-col gap-2.5 bg-card px-4 pt-3.5 pb-3"
      :aria-describedby="undefined"
    >
      <DialogHeader class="flex-row items-center gap-2 pr-8 text-primary">
        <Icon name="sparkles" />
        <DialogTitle class="text-base font-semibold text-foreground">
          {{ t('infra.ask.chooseTitle') }}
        </DialogTitle>
      </DialogHeader>
      <p v-if="chooser.source" class="m-0 text-xs text-muted-foreground">{{ chooser.source }}</p>
      <pre
        class="m-0 max-h-45 overflow-auto rounded-md border bg-muted px-2.5 py-2 font-sans text-xs break-words whitespace-pre-wrap text-muted-foreground"
        >{{ preview }}</pre
      >
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          :class="OPTION"
          :disabled="!hasActiveSession"
          @click="deliver(chooser.text, 'current')"
        >
          <Icon name="message" />
          <span class="text-sm font-medium text-foreground">
            {{ t('infra.ask.chooseCurrent') }}
          </span>
          <span class="text-xs text-dim">
            {{ hasActiveSession ? t('infra.ask.chooseCurrentHint') : t('infra.ask.noSession') }}
          </span>
        </Button>
        <Button variant="outline" :class="OPTION" @click="deliver(chooser.text, 'new')">
          <Icon name="plus" />
          <span class="text-sm font-medium text-foreground">{{ t('infra.ask.chooseNew') }}</span>
          <span class="text-xs text-dim">{{ t('infra.ask.chooseNewHint') }}</span>
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="closeChooser">
          {{ t('common.cancel') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'

const { t } = useI18n()
const { chooser, closeChooser, deliver, hasActiveSession } = useInfraAskAgent()

/** Xem trước có cắt: ngữ cảnh một dòng log có thể dài, và hộp này để CHỌN chứ
 *  không phải để đọc. Người dùng vẫn thấy đủ để nhận ra mình đang gửi gì. */
const preview = computed(() => {
  const text = chooser.text
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
})

// Ô lựa chọn: cả khối là một nút, chữ trái-trên.
const OPTION =
  'h-auto flex-col items-start justify-start gap-0.5 whitespace-normal bg-muted px-3 py-2.5 text-left font-normal text-muted-foreground shadow-none hover:border-ring hover:bg-accent disabled:opacity-55'
</script>
