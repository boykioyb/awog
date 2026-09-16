<template>
  <!-- Phiên BONG BÓNG ở góc phải màn hình — một phiên thu nhỏ.
       Đặt qua Teleport để nó sống ngoài mọi trang, cùng chỗ với dock thu nhỏ.
       Khi đóng, nó chỉ là một viên tròn; khi mở, nó là một phiên thu nhỏ thật. -->
  <Teleport to="body">
    <div class="ixb" :style="{ bottom: offset }">
      <!-- ── Viên tròn khi đóng ─────────────────────────────────────────── -->
      <button
        v-if="!open"
        class="ixb-fab"
        type="button"
        :title="t('infra.bubble.open')"
        @click="openBubble"
      >
        <Icon name="message" />
      </button>

      <!-- ── Khung phiên thu nhỏ khi mở ─────────────────────────────────── -->
      <section v-else class="ixb-panel" :aria-label="t('infra.bubble.title')">
        <header class="ixb-hd">
          <span class="ixb-dot" :class="tone" />
          <span class="ixb-ttl">{{ session?.title || t('infra.bubble.title') }}</span>
          <!-- "Danh sách" ↔ "Hội thoại": hai mặt của cùng một khung. -->
          <button
            class="btn sm"
            type="button"
            :title="pane === 'chat' ? t('infra.bubble.sessions') : t('infra.bubble.chat')"
            @click="setPane(pane === 'chat' ? 'list' : 'chat')"
          >
            <Icon :name="pane === 'chat' ? 'listul' : 'message'" />
          </button>
          <!-- "Mở full" điều hướng về PHIÊN (yêu cầu người dùng), không phải /infra. -->
          <button class="btn sm" type="button" :title="t('infra.bubble.expand')" @click="expand">
            <Icon name="maximize" />
          </button>
          <button
            class="btn sm"
            type="button"
            :title="t('infra.bubble.close')"
            @click="closeBubble"
          >
            <Icon name="x" />
          </button>
        </header>

        <!-- Thư mục tương tác là `awog-infra` — "infra riêng", không phải repo
             đang mở. Hiện ra để người dùng biết phiên này đọc/ghi ở đâu. -->
        <!-- Tên thư mục, không phải đường dẫn tuyệt đối: khung rộng 360px nên
             `/Users/…/Projects/awog-infra` LUÔN bị cắt, và phần bị cắt lại đúng là
             phần mang tin (tên ở cuối). Đường đầy đủ nằm ở `title`. -->
        <p class="ixb-path" :title="workspacePath">
          <Icon name="folder" />
          {{ workspaceName || t('infra.bubble.provisioning') }}
        </p>

        <p v-if="provisionError" class="ixb-err">{{ provisionError }}</p>

        <template v-if="pane === 'list'">
          <InfraBubbleSessions
            :sessions="allSessions"
            :active-id="sessionId"
            @pick="selectSession"
          />
        </template>
        <template v-else>
          <InfraBubbleTranscript :messages="session?.msgs ?? []" />
          <form class="ixb-composer" @submit.prevent="send">
            <textarea
              v-model="draft"
              class="ixb-input"
              rows="2"
              :placeholder="t('infra.bubble.placeholder')"
              :disabled="busy"
              @keydown.enter.exact.prevent="send"
            />
            <button v-if="busy" class="btn sm" type="button" @click="stop">
              <Icon name="stop" />
              {{ t('infra.bubble.stop') }}
            </button>
            <button v-else class="btn pri sm" type="submit" :disabled="!draft.trim()">
              <Icon name="send" />
            </button>
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

<style scoped>
.ixb {
  position: fixed;
  right: 16px;
  z-index: 96;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.ixb-fab {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-pill);
  background: var(--bgEl);
  color: var(--textMuted);
  box-shadow: var(--shadow-md);
  cursor: pointer;
}

.ixb-fab:hover {
  color: var(--text);
}

.ixb-panel {
  width: min(360px, calc(100vw - 32px));
  max-height: min(520px, calc(100vh - 140px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.ixb-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 10px;
  border-bottom: 1px solid var(--border);
}

.ixb-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--textFaint);
  flex: 0 0 auto;
}

.ixb-dot.running {
  background: var(--accent);
}

.ixb-dot.attention {
  background: var(--amber);
}

.ixb-dot.error {
  background: var(--red);
}

.ixb-ttl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixb-path {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ixb-err {
  margin: 0;
  padding: 6px 10px;
  color: var(--red);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixb-composer {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid var(--border);
}

.ixb-input {
  flex: 1;
  min-width: 0;
  resize: none;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}

.ixb-input:focus {
  border-color: var(--accentBorder);
}
</style>
