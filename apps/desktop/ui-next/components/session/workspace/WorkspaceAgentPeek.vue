<template>
  <div class="apeek flex flex-col border-l border-border bg-popover" :class="{ full }">
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
          <div class="truncate text-[10px] text-faint">{{ subtitle }}</div>
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
      <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px]">
        <span class="stchip" :data-st="s.status">
          <component :is="statusIcon" class="sticn" />
          {{ t(`sessions.status.${s.status ?? 'idle'}`) }}
        </span>
        <span v-if="tokLabel" class="text-faint">{{ tokLabel }}</span>
        <span v-if="s.usage?.cost != null" class="ml-auto text-faint">
          ${{ s.usage.cost.toFixed(2) }}
        </span>
      </div>

      <!-- Transcript đầy đủ — cùng component render của màn session nên có hết
           chức năng: markdown/code/mermaid, step đang chạy live, chapter nav…
           Chế độ fullscreen (.apeek.full) bung toàn màn để đọc dài. -->
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

const tokLabel = computed(() =>
  s.value?.usage?.contextTokens ? `${formatTokenCount(s.value.usage.contextTokens)} tok` : '',
)

async function openFull(): Promise<void> {
  if (!s.value?.engineId) return
  void sessionsStore.openByEngineId(s.value.engineId)
  emit('close')
  await navigateTo(`/sessions?id=${encodeURIComponent(s.value.engineId)}`)
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

<style scoped>
/* Drawer trượt đè lên cạnh phải của modal body (parent = relative). */
.apeek {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  max-width: 80%;
  z-index: 30;
  transition: width 0.18s ease;
}
/* Chế độ đọc toàn màn — neo fixed lên viewport (không ancestor nào mang
   transform/filter nên fixed vẫn tới được viewport), phủ lên cả editor modal
   (z 160). */
.apeek.full {
  position: fixed;
  inset: 0;
  width: auto;
  max-width: none;
  z-index: 400;
  border-left: 0;
}
.stchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  padding: 2px 8px;
  color: var(--textMuted);
}
.stchip[data-st='streaming'] {
  border-color: color-mix(in oklab, var(--accent) 42%, transparent);
  background: color-mix(in oklab, var(--accent) 12%, transparent);
  color: var(--accent);
}
.stchip[data-st='awaiting'] {
  border-color: color-mix(in oklab, var(--amber) 42%, transparent);
  background: color-mix(in oklab, var(--amber) 12%, transparent);
  color: var(--amber);
}
.stchip[data-st='error'] {
  border-color: color-mix(in oklab, var(--danger) 42%, transparent);
  background: color-mix(in oklab, var(--danger) 10%, transparent);
  color: var(--danger);
}
.sticn {
  width: 12px;
  height: 12px;
}
.stchip[data-st='streaming'] .sticn {
  animation: apeek-spin 1.6s linear infinite;
}
.stchip[data-st='awaiting'] .sticn {
  animation: apeek-pulse 1.6s ease-in-out infinite;
}
@keyframes apeek-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes apeek-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
