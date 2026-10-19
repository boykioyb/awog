<template>
  <Dialog :open="true" @update:open="(v: boolean) => !v && emit('close')">
    <DialogContent class="flex w-105 max-w-[92vw] flex-col gap-2.5 p-4">
      <DialogTitle class="text-base font-semibold text-foreground">
        {{ t('sessions.team.pickTitle', { title: session.title }) }}
      </DialogTitle>

      <Input
        ref="roleInput"
        v-model="role"
        :placeholder="t('sessions.team.rolePlaceholder')"
        :maxlength="MAX_ROLE_LEN"
        @keydown.esc.prevent="emit('close')"
      />

      <Input
        v-model="query"
        :placeholder="t('sessions.team.searchPlaceholder')"
        @keydown.esc.prevent="emit('close')"
      />

      <div class="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        <!-- Tách khỏi nhóm đứng ngay đầu danh sách, không giấu trong context menu:
             khi người dùng đã mở hộp này ra thì "bỏ ra ngoài" là một lựa chọn ngang
             hàng với "chuyển sang nhóm khác". -->
        <div
          v-if="session.teamRunId"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-dim hover:bg-accent"
          @click="emit('pick', null, null)"
        >
          <Icon name="x" class="size-3.5" />
          <span class="flex-auto truncate">{{ t('sessions.team.detach') }}</span>
        </div>

        <div
          v-for="c in candidates"
          :key="c.id"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-foreground hover:bg-accent"
          @click="pick(c)"
        >
          <span class="size-1.5 flex-none rounded-full" :class="c.dotClass" />
          <span class="flex-auto truncate">{{ c.title }}</span>
          <span v-if="c.current" class="text-xs text-primary">
            {{ t('sessions.team.currentParent') }}
          </span>
        </div>

        <div v-if="!candidates.length" class="px-2.5 py-3.5 text-center text-faint">
          {{ t('sessions.team.noCandidates') }}
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Chọn phiên CHA cho một phiên (chế độ xem "Nhóm" của danh sách phiên). Tên nhóm
// chính là tiêu đề phiên cha, nên hộp này không hỏi tên nhóm — nó chỉ hỏi "nằm dưới
// ai" và "vai gì".
//
// DANH SÁCH ỨNG VIÊN đã loại sẵn bốn thứ mà sidecar cũng sẽ từ chối
// (`sessions.setRunMembership`): chính nó, phiên chưa lưu (chưa có engineId), mọi phiên đang
// nằm DƯỚI nó (nhận làm cha là đóng một chu trình), và mọi phiên ĐÃ là con — nhóm chỉ
// có hai cấp. Lọc ở đây để người dùng không bấm vào một dòng rồi mới ăn toast lỗi;
// sidecar vẫn kiểm lại vì nó là biên thật.
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

// Khớp trần của `sessions.setRunMembership` (MAX_ROLE_LEN), để người dùng bị chặn ngay ở ô
// nhập thay vì ăn lỗi validate sau khi bấm.
const MAX_ROLE_LEN = 60

const role = ref(props.session.teamRole ?? '')
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
  // Lan xuống theo teamRunId. Lặp tới khi không thêm được ai nữa: số phiên hữu
  // hạn nên vòng lặp dừng, kể cả khi dữ liệu trên đĩa có sẵn một chu trình.
  let grew = true
  while (grew) {
    grew = false
    for (const s of props.sessions) {
      const parent = s.teamRunId
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
      .filter((s) => !s.teamRunId)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        title: s.title,
        dotClass: s.teamRunId ? 'bg-faint' : 'bg-primary',
        current: s.engineId === props.session.teamRunId,
      }))
  )
})

function pick(c: { id: number }) {
  emit('pick', c.id, role.value.trim() || null)
}
</script>
