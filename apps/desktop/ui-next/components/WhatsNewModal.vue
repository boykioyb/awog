<template>
  <!-- shadcn Dialog (role=dialog ⇒ OVERLAYS đã phủ). Bấm ngoài / Esc / nút X = đóng. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && closePanel()">
    <DialogContent
      class="flex max-h-[84vh] w-160 max-w-[92vw] flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0"
      :aria-describedby="undefined"
    >
      <DialogHeader class="flex-none flex-row items-center gap-2.5 border-b py-3 pr-12 pl-4">
        <Icon name="tag" class="size-4 text-primary" />
        <DialogTitle class="text-lg font-semibold">{{ t('whatsnew.title') }}</DialogTitle>
      </DialogHeader>
      <div class="overflow-y-auto px-5 py-4">
        <section
          v-for="rel in releases"
          :key="rel.version"
          class="border-t py-3.5 first:border-t-0 first:pt-0.5"
        >
          <header class="mb-2 flex items-baseline gap-2">
            <span class="font-semibold text-foreground">v{{ rel.version }}</span>
            <span class="text-sm text-dim tabular-nums">{{ rel.date }}</span>
          </header>
          <p v-if="rel.highlight" class="mb-2.5 text-muted-foreground">{{ pick(rel.highlight) }}</p>
          <!-- Lưới 2 cột: cột badge tự co theo nhãn rộng nhất để mọi dòng chữ thẳng một
               mép trái bất kể ngôn ngữ. -->
          <ul class="grid grid-cols-[max-content_1fr] items-start gap-x-2.5 gap-y-1.5">
            <li v-for="(item, i) in rel.items" :key="i" class="contents">
              <Badge
                variant="outline"
                class="mt-px justify-center rounded-sm bg-transparent px-1.5 py-px text-sm font-normal whitespace-nowrap"
                :class="KIND_CLASS[item.kind]"
              >
                {{ t(`whatsnew.kind.${item.kind}`) }}
              </Badge>
              <span class="text-foreground">{{ pick(item) }}</span>
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// What's New — bundled changelog (utils/changelog.ts), bilingual items picked by
// the active locale. Dựng trên shadcn Dialog. Open state from useWhatsNew.
import type { ChangeKind, LocalizedText } from '~/utils/changelog'

const { t, locale } = useI18n()
const { open, closePanel, releases } = useWhatsNew()

const pick = (text: LocalizedText) => (locale.value === 'vi' ? text.vi : text.en)

// Each change kind maps to a theme accent so the badge reads at a glance.
const KIND_CLASS: Record<ChangeKind, string> = {
  added: 'border-success text-success',
  improved: 'border-primary text-primary',
  changed: 'border-warning text-warning',
  fixed: 'border-info text-info',
}
</script>
