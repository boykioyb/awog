<template>
  <!-- Drawer trượt đè lên cạnh phải của modal body (parent = relative). `full` = chế độ
       đọc toàn màn: neo fixed lên viewport (không ancestor nào mang transform/filter nên
       fixed vẫn tới được viewport), phủ lên cả editor modal (z 160). -->
  <div
    class="flex flex-col bg-popover transition-[width] duration-200 ease-out"
    :class="placeClass"
  >
    <div v-if="s" class="flex min-h-0 flex-1 flex-col">
      <!-- Header: avatar + tên + role/worktree + hành động. -->
      <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span
          class="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          :style="{ background: avatarColor }"
        >
          {{ initial }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs font-semibold text-foreground">{{ s.title }}</div>
          <div class="truncate text-xs text-faint">{{ subtitle }}</div>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          :title="
            full
              ? t('sessions.workspace.group.peek.unfull')
              : t('sessions.workspace.group.peek.full')
          "
          :aria-label="
            full
              ? t('sessions.workspace.group.peek.unfull')
              : t('sessions.workspace.group.peek.full')
          "
          @click="emit('update:full', !full)"
        >
          <Minimize2 v-if="full" />
          <Maximize2 v-else />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('sessions.workspace.group.peek.open')"
          :aria-label="t('sessions.workspace.group.peek.open')"
          @click="openFull"
        >
          <ExternalLink />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X />
        </Button>
      </div>

      <!-- Status + tokens + cost. -->
      <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Badge variant="outline" class="gap-1.5 font-normal" :class="stChip.badge">
          <component :is="statusIcon" :class="stChip.icon" />
          {{ t(`sessions.status.${s.status ?? 'idle'}`) }}
        </Badge>
        <span v-if="tokLabel" class="text-faint">{{ tokLabel }}</span>
        <span v-if="s.usage?.cost != null" class="ml-auto text-faint">
          ${{ s.usage.cost.toFixed(2) }}
        </span>
      </div>

      <!-- Transcript đầy đủ — cùng component render của màn session nên có hết
           chức năng: markdown/code/mermaid, step đang chạy live, chapter nav…
           Chế độ fullscreen (`full`) bung toàn màn để đọc dài. -->
      <SessionTranscript :messages="s.msgs ?? []" :fallback-when="s.when" :loading="!!s.loading" />
    </div>
    <div v-else class="flex flex-1 items-center justify-center text-xs text-faint">
      {{ t('sessions.workspace.group.peek.gone') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Drawer "chi tiết agent" bên trong board item editor — bấm member trong
// dropdown, avatar trong thread, hay hàng activity strip mở đây thay vì nhảy
// sang tab Sessions. Body nhúng thẳng SessionTranscript (đúng component của
// màn session — lazy qua sessionsStore.ensureLoaded) nên đọc được toàn bộ
// transcript live; `full` (v-model:full) bung drawer ra toàn màn hình; nút ↗
// vẫn nhảy sang tab Sessions đầy đủ khi cần composer.
import { computed, onMounted, watch } from 'vue'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Hourglass,
  LoaderCircle,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useSessionsStore } from '~/stores/sessions'
import { provideSessionScope } from '~/composables/useSessionScope'
import { provideTranscriptSurface } from '~/composables/useTranscriptSurface'
import type { SessionStatus } from '~/composables/useSessionsData'
import { formatTokenCount } from '~/utils/context-window'
import { avatarHue, nameInitial } from '~/utils/avatar-hue'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(defineProps<{ engineId: string; full?: boolean }>(), { full: false })
const emit = defineEmits<{ close: []; 'update:full': [full: boolean] }>()

const { t } = useI18n()
const sessionsStore = useSessionsStore()

const s = computed(() => sessionsStore.sessions.find((x) => x.engineId === props.engineId))

// Khai phạm vi phiên của drawer — SessionTranscript/SessionMessageItem đọc
// useSessionScope() cho byline agent + nút phê duyệt/trả-lời-hỏi; không khai
// thì scope rơi về store.active (phiên người dùng đang mở) → hành động trên
// transcript của peek sẽ nhắm nhầm phiên. Cùng khuôn SessionDetail/SessionGridPane.
provideSessionScope(() => s.value?.id ?? null)

// Surface RIÊNG của peek (ADR 0075): transcript bên trong đăng ký root/reveal
// của nó vào đây. Drawer nằm trong cây SessionDetail (qua workspace panel →
// board → editor) — không khai surface riêng thì transcript của peek đăng ký
// lên surface của SessionDetail và chiếm quyền nhận jump-to-message của màn
// session chính.
provideTranscriptSurface()

const initial = computed(() => nameInitial(s.value?.title))
const subtitle = computed(() => {
  const parts: string[] = []
  if (s.value?.agent?.id) parts.push(s.value.agent.id)
  else if (s.value?.teamRole) parts.push(s.value.teamRole)
  if (s.value?.worktree?.branch) parts.push(s.value.worktree.branch)
  return parts.join(' · ') || props.engineId
})

// Hue avatar giống WorkspaceBoardThread — cùng session ⇒ cùng màu ở cả hai chỗ.
const avatarColor = computed(() => avatarHue(props.engineId))

const STATUS_ICON: Record<SessionStatus, unknown> = {
  streaming: LoaderCircle,
  awaiting: Hourglass,
  done: CircleCheck,
  error: CircleAlert,
  idle: CircleDashed,
}
const statusIcon = computed(() => STATUS_ICON[s.value?.status ?? 'idle'])

// Drawer (neo cạnh phải modal body) ↔ chế độ đọc toàn màn (fixed, z 400).
const placeClass = computed(() =>
  props.full
    ? 'fixed inset-0 z-400 w-auto max-w-none'
    : 'absolute inset-y-0 right-0 z-30 w-85 max-w-[80%] border-l border-border',
)

// Màu chip trạng thái: streaming = brand + icon xoay, awaiting = cảnh báo + icon nhấp
// nháy, error = đỏ; còn lại viền trung tính.
const stChip = computed<{ badge: string; icon: string }>(() => {
  const st = s.value?.status
  if (st === 'streaming') {
    return {
      badge: 'border-primary/40 bg-primary/10 text-primary',
      icon: 'animate-[spin_1.6s_linear_infinite]',
    }
  }
  if (st === 'awaiting') {
    return { badge: 'border-warning/40 bg-warning/10 text-warning', icon: 'animate-pulse' }
  }
  if (st === 'error') {
    return { badge: 'border-destructive/40 bg-destructive/10 text-destructive', icon: '' }
  }
  return { badge: 'text-muted-foreground', icon: '' }
})

const tokLabel = computed(() =>
  s.value?.usage?.contextTokens ? `${formatTokenCount(s.value.usage.contextTokens)} tok` : '',
)

async function openFull(): Promise<void> {
  if (!s.value?.engineId) return
  void sessionsStore.openByEngineId(s.value.engineId)
  emit('close')
  await navigateTo(`/workbench?id=${encodeURIComponent(s.value.engineId)}`)
}

onMounted(() => {
  // Transcript lazy — shell trên danh sách chưa có msgs.
  if (s.value?.id != null) void sessionsStore.ensureLoaded(s.value.id)
})
watch(
  () => props.engineId,
  () => {
    if (s.value?.id != null) void sessionsStore.ensureLoaded(s.value.id)
  },
)
</script>
