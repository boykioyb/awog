<template>
  <!-- Phiên BONG BÓNG ở góc phải màn hình — một phiên thu nhỏ.
       Đặt qua Teleport để nó sống ngoài mọi trang, cùng chỗ với dock thu nhỏ.
       Khi đóng, nó chỉ là một viên tròn; khi mở, nó là một phiên thu nhỏ thật. -->
  <Teleport to="body">
    <div class="fixed right-4 z-96 flex flex-col items-end" :style="{ bottom: offset }">
      <!-- ── Viên tròn khi đóng ─────────────────────────────────────────── -->
      <Button
        v-if="!open"
        variant="outline"
        size="icon"
        class="size-ctrl-lg rounded-full bg-card text-muted-foreground shadow-md hover:text-foreground"
        type="button"
        :title="t('infra.bubble.open')"
        :aria-label="t('infra.bubble.open')"
        @click="openBubble"
      >
        <Icon name="message" />
      </Button>

      <!-- ── Khung phiên thu nhỏ khi mở ─────────────────────────────────── -->
      <section
        v-else
        class="flex max-h-[min(520px,calc(100vh-140px))] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-input bg-card shadow-lg"
        :aria-label="t('infra.bubble.title')"
      >
        <header class="flex items-center gap-1.5 border-b py-1.5 pr-2 pl-2.5">
          <span
            class="size-2 flex-none rounded-full"
            :class="{
              'bg-faint': tone === 'idle',
              'bg-primary': tone === 'running',
              'bg-warning': tone === 'attention',
              'bg-destructive': tone === 'error',
            }"
          />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {{ session?.title || t('infra.bubble.title') }}
          </span>
          <!-- "Danh sách" ↔ "Hội thoại": hai mặt của cùng một khung. -->
          <Button
            type="button"
            :title="pane === 'chat' ? t('infra.bubble.sessions') : t('infra.bubble.chat')"
            :aria-label="pane === 'chat' ? t('infra.bubble.sessions') : t('infra.bubble.chat')"
            variant="ghost"
            size="iconSm"
            @click="setPane(pane === 'chat' ? 'list' : 'chat')"
          >
            <Icon :name="pane === 'chat' ? 'listul' : 'message'" />
          </Button>
          <!-- "Mở full" điều hướng về PHIÊN (yêu cầu người dùng), không phải /infra. -->
          <Button
            type="button"
            :title="t('infra.bubble.expand')"
            :aria-label="t('infra.bubble.expand')"
            variant="ghost"
            size="iconSm"
            @click="expand"
          >
            <Icon name="maximize" />
          </Button>
          <Button
            type="button"
            :title="t('infra.bubble.close')"
            :aria-label="t('infra.bubble.close')"
            variant="ghost"
            size="iconSm"
            @click="closeBubble"
          >
            <Icon name="x" />
          </Button>
        </header>

        <!-- Thư mục tương tác là `awog-infra` — "infra riêng", không phải repo
             đang mở. Hiện ra để người dùng biết phiên này đọc/ghi ở đâu. -->
        <!-- Tên thư mục, không phải đường dẫn tuyệt đối: khung rộng 360px nên
             `/Users/…/Projects/awog-infra` LUÔN bị cắt, và phần bị cắt lại đúng là
             phần mang tin (tên ở cuối). Đường đầy đủ nằm ở `title`. -->
        <p
          class="m-0 flex items-center gap-1 truncate border-b px-2.5 py-1 text-xs text-faint"
          :title="workspacePath"
        >
          <Icon name="folder" class="size-3.5 flex-none" />
          {{ workspaceName || t('infra.bubble.provisioning') }}
        </p>

        <p v-if="provisionError" class="m-0 px-2.5 py-1.5 text-xs text-destructive">
          {{ provisionError }}
        </p>

        <template v-if="pane === 'list'">
          <InfraBubbleSessions
            :sessions="allSessions"
            :active-id="sessionId"
            @pick="selectSession"
          />
        </template>
        <template v-else>
          <InfraBubbleTranscript :messages="session?.msgs ?? []" />
          <form class="flex items-end gap-1.5 border-t px-2 py-1.5" @submit.prevent="send">
            <!-- resize-none: ô soạn tin của bong bóng, cao cố định 2 dòng như composer. -->
            <Textarea
              v-model="draft"
              class="min-h-0 min-w-0 flex-1 resize-none px-2 py-1.5"
              rows="2"
              :placeholder="t('infra.bubble.placeholder')"
              :disabled="busy"
              @keydown.enter.exact.prevent="send"
            />
            <Button v-if="busy" type="button" variant="outline" size="sm" @click="stop">
              <Icon name="stop" />
              {{ t('infra.bubble.stop') }}
            </Button>
            <Button v-else type="submit" :disabled="!draft.trim()" variant="default" size="iconMd">
              <Icon name="send" />
            </Button>
          </form>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Bong bóng là một PHIÊN THẬT, chỉ khác bề rộng. Mọi thứ nó làm — gửi tin, dừng
// lượt, đổi phiên — đều gọi đúng store mà màn phiên gọi, nên không có trạng thái
// thứ hai để lệch. Xem `useInfraBubble` cho phần project `awog-infra` + thư mục.
import { computed, ref } from 'vue'
import InfraBubbleSessions from '~/components/infra/bubble/InfraBubbleSessions.vue'
import InfraBubbleTranscript from '~/components/infra/bubble/InfraBubbleTranscript.vue'
import { useInfraBubble } from '~/composables/useInfraBubble'
import { useMinimizeDock } from '~/composables/useMinimizeDock'
import { useSessionsStore } from '~/stores/sessions'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const {
  open,
  pane,
  sessionId,
  session,
  allSessions,
  workspacePath,
  provisioning,
  provisionError,
  openBubble,
  closeBubble,
  expand,
  selectSession,
  setPane,
} = useInfraBubble()

const sessions = useSessionsStore()
const dock = useMinimizeDock()

/**
 * Chỗ đứng ở góc phải. Dock thu nhỏ cũng ở góc này (bottom 46px, cao lên theo
 * số mục đang ghim) — hai bề mặt chồng nhau là hai bề mặt không dùng được. Bong
 * bóng vì thế đứng CAO HƠN dock, và tự nâng lên khi dock đầy lên.
 */
const offset = computed(() => `${46 + dock.entries.length * 44}px`)

const draft = ref('')
const busy = computed(() => session.value?.status === 'streaming')

type Tone = 'idle' | 'running' | 'attention' | 'error'
const tone = computed<Tone>(() => {
  const st = session.value?.status
  if (st === 'streaming') return 'running'
  if (st === 'awaiting') return 'attention'
  if (st === 'error') return 'error'
  return 'idle'
})

/** Đoạn cuối của đường dẫn — thứ người đọc cần, và thứ bị cắt mất khi hiện cả đường. */
const workspaceName = computed(() => workspacePath.value.replace(/\/+$/, '').split('/').pop() ?? '')

const provisioned = computed(() => !provisioning.value && workspacePath.value !== '')

function send(): void {
  const text = draft.value.trim()
  const id = sessionId.value
  if (!text || id == null || !provisioned.value) return
  draft.value = ''
  void sessions.sendMessage(id, text)
}

function stop(): void {
  const id = sessionId.value
  if (id != null) void sessions.cancel(id)
}
</script>
