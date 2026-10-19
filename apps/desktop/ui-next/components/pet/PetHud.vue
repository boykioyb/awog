<template>
  <div class="flex flex-col gap-0.5 rounded-lg border bg-card p-1.5 text-foreground shadow-lg">
    <template v-if="model.state === 'offline'">
      <div class="px-2 py-1.5 text-dim">{{ t('pet.offline') }}</div>
    </template>

    <template v-else>
      <Button
        v-for="item in model.items"
        :key="`${item.kind}-${item.id}`"
        variant="ghost"
        class="h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left text-base font-normal whitespace-normal text-foreground"
        @click="emit('open', item)"
      >
        <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="dotClass(item.hint)" />
        <!-- Hai dòng: tiêu đề + đang làm gì. Chấm nằm ở dòng đầu. -->
        <span class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="flex min-w-0 items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
            <!-- px-ok: chip phụ cỡ cố định — hàng HUD không được nở khi tăng cỡ chữ app -->
            <span class="shrink-0 text-[12px] tabular-nums" :class="metaClass(item.hint)">
              {{ metaOf(item) }}
            </span>
          </span>
          <!-- What it is actually saying/doing right now. Without this the HUD only
               repeats the session titles, which is the least changing thing about it. -->
          <!-- px-ok: chữ phụ cỡ cố định — hàng không nở khi người dùng tăng cỡ chữ app -->
          <span v-if="item.preview" class="truncate text-[12px] leading-[18px] text-dim">
            {{ item.preview }}
          </span>
        </span>
      </Button>

      <Button
        v-if="extra > 0"
        variant="ghost"
        class="h-auto w-full items-start justify-center gap-2 px-2 py-1.5 text-left text-base font-normal whitespace-normal text-dim"
        @click="emit('activity')"
      >
        {{ t('pet.more', { count: extra }) }}
      </Button>

      <div v-if="!model.items.length" class="px-2 py-1.5 text-dim">{{ t('pet.empty') }}</div>

      <!-- Permission: the summary always shows, the buttons only when the HUD is
           deliberately open (hover/pinned) — never during an auto-peek, so a glance
           can't turn into an accidental approval. -->
      <Separator v-if="model.permission" class="mt-1" />
      <div v-if="model.permission" class="flex flex-col gap-1.5 p-2">
        <div class="flex min-w-0 items-baseline gap-1.5">
          <span class="shrink-0 font-semibold text-warning">{{ model.permission.toolName }}</span>
          <span v-if="model.permission.target" class="min-w-0 flex-1 truncate text-dim">
            <!-- mono-ok: đích của tool (path / lệnh). px-ok: chữ phụ cỡ cố định -->
            <span class="font-mono text-[12px] leading-[18px]">{{ model.permission.target }}</span>
          </span>
        </div>
        <!-- Khoảng cách rộng có chủ đích: bấm nhầm ở đây là duyệt một lệnh gọi tool. -->
        <div v-if="expanded" class="flex justify-end gap-3">
          <Button variant="outline" size="sm" class="text-dim" @click="emit('decide', 'deny')">
            {{ t('pet.perm.deny') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="border-primary/60 text-primary hover:text-primary"
            @click="emit('decide', 'allow')"
          >
            {{ t('pet.perm.allow') }}
          </Button>
        </div>
        <div v-else class="text-dim">{{ t('pet.perm.hint') }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AwogPetItem, AwogPetModel } from '~/types/awog-bridge'

// Mini-HUD next to the pet (docs/features/desktop-pet.md): at most three rows of
// what needs the user, plus the parked permission. Deliberately NOT a second tray
// popover — no rate limits, no usage, no scrolling. Anything bigger belongs in the
// app, which is one click away on any row.
const props = defineProps<{ model: AwogPetModel; expanded: boolean }>()
const emit = defineEmits<{
  open: [item: AwogPetItem]
  activity: []
  decide: [decision: 'allow' | 'deny']
}>()

const { t } = useI18n()

// How much did not fit in the three rows — surfaced so the HUD never silently
// hides work.
const extra = computed(() => {
  const { running, attention, unread } = props.model.counts
  return Math.max(0, running + attention + unread - props.model.items.length)
})

// Màu theo trạng thái: chờ duyệt = cảnh báo, đang chạy = primary, chưa đọc = thành công.
function dotClass(hint: AwogPetItem['hint']): string {
  if (hint === 'awaiting') return 'bg-warning'
  if (hint === 'running') return 'bg-primary'
  if (hint === 'unread') return 'bg-success'
  return 'bg-muted-foreground'
}
function metaClass(hint: AwogPetItem['hint']): string {
  if (hint === 'awaiting') return 'text-warning'
  if (hint === 'running') return 'text-primary'
  return 'text-dim'
}

function metaOf(item: AwogPetItem): string {
  if (item.hint === 'running' && typeof item.percent === 'number') return `${item.percent}%`
  return t(`pet.hint.${item.hint}`)
}
</script>
