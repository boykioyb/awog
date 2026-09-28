<template>
  <Teleport to="body">
    <div v-if="req" class="arm-ovl" @click.self="deny">
      <div class="arm-card" role="dialog" aria-modal="true" :aria-label="t('sessions.arm.title')">
        <div class="arm-head">
          <div class="arm-headtx">
            <div class="arm-title">
              <Icon name="zap" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('sessions.arm.title') }}
            </div>
            <div class="arm-sub">{{ t('sessions.arm.sub', { parent: callerTitle }) }}</div>
          </div>
          <button class="arm-x" :aria-label="t('common.close')" @click="deny">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="arm-body">
          <div v-if="req.reason" class="arm-reason">{{ req.reason }}</div>
          <div class="arm-note">{{ t('sessions.arm.body') }}</div>
        </div>

        <div class="arm-foot">
          <div class="arm-actions">
            <button class="btn" :disabled="busy" @click="deny">
              {{ t('sessions.arm.deny') }}
            </button>
            <button class="btn pri" :disabled="busy" @click="approve">
              {{ t('sessions.arm.approve') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Popover "BẬT TỰ-GIAO NHÓM" — cổng duyệt duy nhất của tool `arm_group`
// (docs/features/session-groups.md). Model xin bật `groupAutoDeliver` trên gốc
// nhóm; request park ở sidecar (spawn-approval.ts) chờ popover này trả lời qua
// `sessions.armResolve`. Đóng/Esc/Từ chối = KHÔNG duyệt (mặc định an toàn);
// Duyệt = arm nhóm + nhả mọi tin đang park giữa các phiên trong nhóm.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'

defineOptions({ name: 'SessionArmHost' })

const { t } = useI18n()
const store = useSessionsStore()

const req = computed(() => store.pendingArm)
const busy = ref(false)

const callerTitle = computed(() => {
  const r = req.value
  if (!r) return ''
  return store.byEngineId(r.sessionId)?.title ?? r.sessionId
})

// Esc = đường deny. Không có menu AppSelect nào trong dialog này nên không cần
// né `.aselmenu` như SessionSpawnHost.
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') void deny()
}
watch(req, (v) => {
  if (v) window.addEventListener('keydown', onEsc)
  else window.removeEventListener('keydown', onEsc)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

async function answer(approved: boolean) {
  const r = req.value
  if (!r || busy.value) return
  busy.value = true
  try {
    await store.resolveArm({ requestId: r.requestId, approved })
  } finally {
    busy.value = false
  }
}
const approve = () => answer(true)
const deny = () => answer(false)
</script>

<style scoped>
.arm-ovl {
  position: fixed;
  inset: 0;
  /* Ngang hàng overlay của popover spawn (155): hai popover có thể xếp chồng
     khi cha vừa spawn vừa xin arm — request nào tới sau nằm trên. */
  z-index: 155;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.arm-card {
  width: 440px;
  max-width: 94vw;
  display: flex;
  flex-direction: column;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.arm-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.arm-headtx {
  flex: 1;
  min-width: 0;
}
.arm-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.arm-title :first-child {
  color: var(--accent);
}
.arm-sub {
  margin-top: 3px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.arm-x {
  border: 0;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-xs);
}
.arm-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.arm-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.arm-reason {
  padding: 8px 10px;
  border: 1px dashed var(--borderStrong);
  border-radius: var(--r-sm);
  background: var(--bg);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* Lý do do MODEL viết — L2 content; cắt dòng dài cho khỏi phá layout. */
  overflow-wrap: anywhere;
}
.arm-note {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.arm-foot {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}
.arm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.arm-actions .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
