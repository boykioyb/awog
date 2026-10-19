<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('cancel')">
    <!-- z-200: confirm mở từ trong modal khác (Git modal z-120, Git prompt z-150) phải
         nằm trên nó — cùng bậc TextPromptHost. -->
    <DialogContent class="z-200 w-105 max-w-[92vw] gap-3.5 border-input bg-card p-4.5">
      <DialogHeader class="flex-row items-center gap-2 pr-8">
        <Icon
          name="alert"
          class="flex-none"
          :class="kind === 'danger' ? 'text-destructive' : 'text-primary'"
        />
        <DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle>
      </DialogHeader>
      <DialogDescription class="text-sm whitespace-pre-wrap text-muted-foreground">
        {{ description }}
      </DialogDescription>
      <slot name="extra" />
      <DialogFooter>
        <Button variant="outline" @click="emit('cancel')">
          {{ cancelLabel || t('common.cancel') }}
        </Button>
        <Button :variant="kind === 'danger' ? 'destructive' : 'default'" @click="emit('confirm')">
          {{ confirmLabel || (kind === 'danger' ? t('common.delete') : t('common.confirm')) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Shared confirm-delete dialog for every library feature (skills, agents,
// commands, rules, hooks, connections). Port of the old UI ConfirmDeleteModal,
// dựng trên Dialog shadcn (Escape / bấm scrim / nút X đều = cancel qua
// `update:open`). `kind` controls the icon color + confirm style;
// defaults to 'danger' so the common Delete flow stays red. Caller owns the
// open state + supplies localized title/description.
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    kind?: 'danger' | 'primary'
    confirmLabel?: string
    cancelLabel?: string
  }>(),
  { kind: 'danger', confirmLabel: '', cancelLabel: '' },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>
