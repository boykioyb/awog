<template>
  <Teleport to="body">
    <div class="sgp-ovl" @click.self="emit('close')">
      <div class="sgp-card" role="dialog" aria-modal="true">
        <div class="sgp-title">{{ t('sessions.group.pickTitle', { title: session.title }) }}</div>

        <input
          ref="roleInput"
          v-model="role"
          class="sgp-input"
          :placeholder="t('sessions.group.rolePlaceholder')"
          :maxlength="MAX_ROLE_LEN"
          @keydown.esc.prevent="emit('close')"
        />

        <input
          v-model="query"
          class="sgp-input"
          :placeholder="t('sessions.group.searchPlaceholder')"
          @keydown.esc.prevent="emit('close')"
        />

        <div class="sgp-list">
          <!-- Tách khỏi nhóm đứng ngay đầu danh sách, không giấu trong context menu:
               khi người dùng đã mở hộp này ra thì "bỏ ra ngoài" là một lựa chọn ngang
               hàng với "chuyển sang nhóm khác". -->
          <div
            v-if="session.groupParentId"
            class="sgp-row sgp-detach"
            @click="emit('pick', null, null)"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="sgp-rowttl">{{ t('sessions.group.detach') }}</span>
          </div>

          <div v-for="c in candidates" :key="c.id" class="sgp-row" @click="pick(c)">
            <span class="sgp-dot" :style="{ background: c.dot }" />
            <span class="sgp-rowttl">{{ c.title }}</span>
            <span v-if="c.current" class="sgp-cur">{{ t('sessions.group.currentParent') }}</span>
          </div>

          <div v-if="!candidates.length" class="sgp-empty">
            {{ t('sessions.group.noCandidates') }}
          </div>
        </div>

        <div class="sgp-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Chọn phiên CHA cho một phiên (chế độ xem "Nhóm" của danh sách phiên). Tên nhóm
// chính là tiêu đề phiên cha, nên hộp này không hỏi tên nhóm — nó chỉ hỏi "nằm dưới
// ai" và "vai gì".
//
// DANH SÁCH ỨNG VIÊN đã loại sẵn bốn thứ mà sidecar cũng sẽ từ chối
// (`sessions.setGroup`): chính nó, phiên chưa lưu (chưa có engineId), mọi phiên đang
// nằm DƯỚI nó (nhận làm cha là đóng một chu trình), và mọi phiên ĐÃ là con — nhóm chỉ
// có hai cấp. Lọc ở đây để người dùng không bấm vào một dòng rồi mới ăn toast lỗi;
// sidecar vẫn kiểm lại vì nó là biên thật.
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{
  // Phiên đang được xếp nhóm.
  session: Session
  // Mọi phiên đang hiển thị (nguồn để dựng danh sách ứng viên).
  sessions: Session[]
}>()

const emit = defineEmits<{
  // parentClientId = null ⇒ tách khỏi nhóm.
  (e: 'pick', parentClientId: number | null, role: string | null): void
  (e: 'close'): void
}>()

const { t } = useI18n()

// Khớp trần của `sessions.setGroup` (MAX_ROLE_LEN), để người dùng bị chặn ngay ở ô
// nhập thay vì ăn lỗi validate sau khi bấm.
const MAX_ROLE_LEN = 60

const role = ref(props.session.groupRole ?? '')
const query = ref('')
const roleInput = useTemplateRef<HTMLInputElement>('roleInput')

onMounted(() => {
  nextTick(() => roleInput.value?.focus())
})

// engineId của mọi phiên nằm dưới `session` (mọi tầng) + chính nó — tập cấm.
const banned = computed<Set<string>>(() => {
  const self = props.session.engineId
  const banned = new Set<string>()
  if (self) banned.add(self)
  // Lan xuống theo groupParentId. Lặp tới khi không thêm được ai nữa: số phiên hữu
  // hạn nên vòng lặp dừng, kể cả khi dữ liệu trên đĩa có sẵn một chu trình.
  let grew = true
  while (grew) {
    grew = false
    for (const s of props.sessions) {
      const parent = s.groupParentId
      if (!s.engineId || !parent) continue
      if (banned.has(parent) && !banned.has(s.engineId)) {
        banned.add(s.engineId)
        grew = true
      }
    }
  }
  return banned
})

const candidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (
    props.sessions
      .filter((s) => s.engineId && !banned.value.has(s.engineId))
      // Nhóm chỉ có HAI CẤP: chỉ phiên CHƯA thuộc nhóm nào mới làm cha được. Một phiên đã
      // là con mà nhận thêm con nữa là cấp thứ ba — sidecar cũng từ chối (`nested-parent`),
      // nên hiện nó ở đây chỉ để người dùng bấm vào rồi ăn lỗi.
      .filter((s) => !s.groupParentId)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        title: s.title,
        dot: s.groupParentId ? 'var(--textFaint)' : 'var(--accent)',
        current: s.engineId === props.session.groupParentId,
      }))
  )
})

function pick(c: { id: number }) {
  emit('pick', c.id, role.value.trim() || null)
}
</script>

<style scoped>
.sgp-ovl {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.sgp-card {
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.sgp-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.sgp-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.sgp-input:focus {
  border-color: var(--accent);
}
.sgp-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sgp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--text);
}
.sgp-row:hover {
  background: var(--bgHover);
}
.sgp-detach {
  color: var(--textDim);
}
.sgp-dot {
  width: 6px; /* design-token-ok: chấm tròn — con số px CHÍNH LÀ hình dạng */
  height: 6px; /* design-token-ok: chấm tròn */
  border-radius: 50%;
  flex: 0 0 auto;
}
.sgp-rowttl {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sgp-cur {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
}
.sgp-empty {
  padding: 14px 10px;
  color: var(--textFaint);
  text-align: center;
}
.sgp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
