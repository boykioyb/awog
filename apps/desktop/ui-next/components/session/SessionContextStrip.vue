<template>
  <!-- MỘT hàng ngữ cảnh thay cho tối đa sáu hàng banner chồng nhau
       (session-ui-refactor §3.2): link task · host SSH + mức duyệt · cảnh báo duyệt
       tự động · checklist · đánh dấu. Mỗi thứ giờ là một chip mở popover của chính
       nó, nên chúng chia nhau MỘT dòng 30px thay vì mỗi thứ chiếm trọn bề ngang.

       Không có chip nào thì KHÔNG render — transcript không mất một pixel chiều cao
       nào cho tính năng người dùng không dùng (giữ đúng luật AC-B7 của bookmark bar).

       Chip checklist và chip đánh dấu do chính SessionTodoPanel / SessionBookmarkBar
       vẽ (biến thể `chip`): logic của chúng ở lại đúng chỗ cũ, strip này chỉ lo bố
       cục. Điều kiện hiện/ẩn vì thế phải tính LẠI ở đây — con không nói ngược lên
       cha được, mà cha thì cần biết có nên render hàng hay không. -->
  <div v-if="show" class="ctxstrip">
    <!-- Task (ADR 0055): bấm thẳng là mở task, như banner cũ — không popover, vì nó
         chỉ có đúng một hành động. -->
    <button
      v-if="session.aboutTaskId"
      class="ctxchip"
      :title="t('sessions.detail.aboutTask')"
      @click="openTask(session.aboutTaskId)"
    >
      <Icon name="workflows" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="ctxchip-lbl">{{ aboutTaskTitle }}</span>
    </button>

    <!-- SSH (ADR 0064). Mức duyệt nằm trong popover; `auto` nhuộm chip sang màu cảnh
         báo — thay cho một HÀNG warn riêng, vì cảnh báo thuộc về chính cái công tắc
         gây ra nó chứ không phải một dải chữ đỏ ngang màn hình. -->
    <span v-if="session.aboutSshHostId" class="ctxwrap">
      <button
        class="ctxchip"
        :class="{ warn: sshApprovalMode === 'auto', on: open === 'ssh' }"
        :title="t('sessions.detail.aboutSshHost')"
        @click.stop="toggle('ssh')"
      >
        <Icon name="ssh" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="ctxchip-lbl">{{ aboutSshHostName }}</span>
        <span class="ctxchip-sub">· {{ sshApprovalShort }}</span>
        <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
      <div v-if="open === 'ssh'" class="pop ctxpop" @click.stop>
        <div class="pl">{{ t('sessions.detail.sshApproval.label') }}</div>
        <AppSelect
          :model-value="sshApprovalMode"
          :options="sshApprovalOptions"
          width="100%"
          @update:model-value="onSshApprovalMode"
        />
        <p v-if="sshApprovalMode === 'auto'" class="ctxwarn">
          {{ t('sessions.detail.sshApproval.autoWarn') }}
        </p>
        <button class="ctxpop-act" @click="goSshHost">
          <Icon name="ssh" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.detail.aboutSshHost') }}
          <Icon name="chev" class="ctxpop-chev" />
        </button>
      </div>
    </span>

    <SessionTodoPanel :session="session" variant="chip" />
    <SessionBookmarkBar :session="session" variant="chip" />

    <div v-if="open" class="ctxbackdrop" @click="open = null" />
  </div>
</template>

<script setup lang="ts">
// Hàng ngữ cảnh của một phiên: "phiên này về cái gì" (task / host SSH) + hai chỉ dẫn
// đọc (checklist / đánh dấu). Tách khỏi SessionDetail vì đó là một lý do thay đổi
// riêng — SessionDetail chỉ còn lo header + chat + panel.
import type { Session, SshApprovalMode } from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()
const { openTask, openSshHost } = useSessionTaskLink()

// ── Task (ADR 0055) ────────────────────────────────────────────────────────
const tasksStore = useTasksStore()
const aboutTask = computed(() =>
  props.session.aboutTaskId ? tasksStore.taskById(props.session.aboutTaskId) : undefined,
)
const aboutTaskTitle = computed(() => aboutTask.value?.title ?? props.session.aboutTaskId)
onMounted(() => {
  if (props.session.aboutTaskId && !aboutTask.value) void tasksStore.loadTasks()
})

// ── Host SSH (ADR 0064) ────────────────────────────────────────────────────
const sshStore = useSshStore()
const aboutSshHost = computed(() =>
  props.session.aboutSshHostId ? sshStore.hostById(props.session.aboutSshHostId) : undefined,
)
const aboutSshHostName = computed(() => aboutSshHost.value?.name ?? props.session.aboutSshHostId)
onMounted(() => {
  if (props.session.aboutSshHostId && !aboutSshHost.value) void sshStore.loadAll()
})

// Mức duyệt công cụ SSH của phiên (ADR 0064 P2). Chi phối các tool ghi
// (ssh_exec / ssh_write_file); mặc định 'prompt'. Engine đọc theo từng lượt.
const sshApprovalMode = computed<SshApprovalMode>(() => props.session.sshApprovalMode ?? 'prompt')
const sshApprovalOptions = computed<AppSelectOption[]>(() => [
  { label: t('sessions.detail.sshApproval.prompt'), value: 'prompt' },
  { label: t('sessions.detail.sshApproval.session'), value: 'session' },
  { label: t('sessions.detail.sshApproval.auto'), value: 'auto' },
])
// Nhãn ngắn trên chip — nhãn đầy đủ ở trong popover.
const sshApprovalShort = computed(
  () => sshApprovalOptions.value.find((o) => o.value === sshApprovalMode.value)?.label ?? '',
)
function onSshApprovalMode(v: string) {
  store.setSshApprovalMode(props.session.id, v as SshApprovalMode)
}
function goSshHost() {
  open.value = null
  if (props.session.aboutSshHostId) openSshHost(props.session.aboutSshHostId)
}

// ── Hiện/ẩn cả hàng ────────────────────────────────────────────────────────
// Hai điều kiện cuối lặp lại luật của SessionTodoPanel / SessionBookmarkBar: con tự
// ẩn chip của nó, nhưng cha phải biết TRƯỚC để không vẽ một dải 30px rỗng.
const { bannerVisible } = useSessionTodo(() => props.session)
const hasBookmarks = computed(
  () => !!props.session.loaded && (props.session.bookmarks?.length ?? 0) > 0,
)
const show = computed(
  () =>
    !!props.session.aboutTaskId ||
    !!props.session.aboutSshHostId ||
    bannerVisible.value ||
    hasBookmarks.value,
)

// Một popover mở tại một thời điểm (chip SSH ở đây; chip checklist và chip đánh dấu
// tự quản popover của chúng, và backdrop của chúng cũng đóng cái này).
const open = ref<'ssh' | null>(null)
function toggle(k: 'ssh') {
  open.value = open.value === k ? null : k
}
</script>

<style scoped>
.ctxwrap {
  position: relative;
  display: inline-flex;
  flex: 0 1 auto;
  min-width: 0;
}
/* Popover của chip SSH. `bottom` không dùng được: strip nằm ở ĐẦU cột chat nên menu
   mở XUỐNG. */
.ctxpop {
  position: absolute;
  top: 128%;
  left: 0;
  z-index: 50;
  min-width: 232px;
}
.ctxpop .pl {
  margin-bottom: 6px;
}
.ctxwarn {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.ctxpop-act {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 9px;
  padding: 7px 9px;
  border: 0;
  background: transparent;
  border-radius: var(--r-xs);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  text-align: left;
}
.ctxpop-act:hover {
  background: var(--bgHover);
}
.ctxpop-act .icn {
  color: var(--textDim);
  flex: 0 0 auto;
}
.ctxpop-chev {
  margin-left: auto;
  transform: rotate(-90deg);
}
.ctxbackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
</style>
