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
  <!-- Hàng sống TRONG header `.dh` của SessionDetail: chỉ là một cụm chip inline co
       được (min-w-0 + chip tự cắt ellipsis), không lề/đường kẻ riêng. -->
  <div v-if="show" class="flex min-w-0 shrink items-center gap-2">
    <!-- Issue trên board mà phiên đang làm — đứng ĐẦU hàng: "phiên này là việc gì,
         đang ở đâu" là câu hỏi đầu tiên khi quay lại một phiên. -->
    <SessionIssueChip :session="session" />

    <!-- Thread Slack mà phiên này xử lý (docs/features/slack-threads.md): bấm mở cửa
         sổ Slack tới đúng thread. Tự ẩn khi phiên không gắn thread. -->
    <SlackThreadChip :session="session" />

    <!-- Task (ADR 0055): bấm thẳng là mở task, như banner cũ — không popover, vì nó
         chỉ có đúng một hành động. -->
    <SessionCtxChip
      v-if="session.aboutTaskId"
      icon="workflows"
      :label="aboutTaskTitle ?? ''"
      :title="t('sessions.detail.aboutTask')"
      @click="openTask(session.aboutTaskId)"
    />

    <!-- SSH (ADR 0064). Mức duyệt nằm trong popover; `auto` nhuộm chip sang màu cảnh
         báo — thay cho một HÀNG warn riêng, vì cảnh báo thuộc về chính cái công tắc
         gây ra nó chứ không phải một dải chữ đỏ ngang màn hình. -->
    <span v-if="session.aboutSshHostId" class="relative inline-flex min-w-0 shrink">
      <SessionCtxChip
        ref="sshChipRef"
        icon="ssh"
        :label="aboutSshHostName ?? ''"
        :sub="`· ${sshApprovalShort}`"
        chev
        :warn="sshApprovalMode === 'auto'"
        :on="open === 'ssh'"
        :title="t('sessions.detail.aboutSshHost')"
        @click.stop="toggle('ssh')"
      />
    </span>

    <!-- Hạ tầng (ADR 0088): chip tự quản popover + màu của nó, đúng khuôn chip SSH
         phía trên. Nó cũng tự ẩn khi phiên không ghim ngữ cảnh nào. -->
    <InfraChip :session="session" />
    <!-- kubectl + Terraform (ADR 0088 §7, P1/P2): cùng hàng, mỗi chip tự ẩn khi
         máy/project không có gì để chọn. -->
    <InfraKubectlChip :session="session" />
    <InfraTerraformChip :session="session" />

    <SessionTodoPanel :session="session" variant="chip" />
    <SessionBookmarkBar :session="session" variant="chip" />

    <!-- Popover + backdrop teleport ra <body> và neo `fixed` qua usePopoverAnchor:
         chip giờ nằm trên hàng header `.dh` nên `absolute; left:0` sát mép phải
         sẽ thò ra ngoài cửa sổ. -->
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-40" @click="open = null" />
      <SessionCtxPop
        v-if="open === 'ssh'"
        ref="sshPopRef"
        class="w-71 min-w-58"
        :style="sshPopStyle"
        @click.stop
      >
        <div class="mb-1.5 flex justify-between text-sm text-dim">
          {{ t('sessions.detail.sshApproval.label') }}
        </div>
        <AppSelect
          :model-value="sshApprovalMode"
          :options="sshApprovalOptions"
          width="100%"
          @update:model-value="onSshApprovalMode"
        />
        <p v-if="sshApprovalMode === 'auto'" class="mt-2 mb-0 text-xs leading-4.5 text-warning">
          {{ t('sessions.detail.sshApproval.autoWarn') }}
        </p>
        <!-- Hàng hành động trong popover — cùng nhịp menu item: padding gọn, hover wash. -->
        <Button
          variant="ghost"
          size="sm"
          class="mt-2 h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-sm font-normal text-popover-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          @click="goSshHost"
        >
          <Icon name="ssh" />
          {{ t('sessions.detail.aboutSshHost') }}
          <Icon name="chev" class="ml-auto -rotate-90" />
        </Button>
      </SessionCtxPop>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Hàng ngữ cảnh của một phiên: "phiên này về cái gì" (task / host SSH) + hai chỉ dẫn
// đọc (checklist / đánh dấu). Tách khỏi SessionDetail vì đó là một lý do thay đổi
// riêng — SessionDetail chỉ còn lo header + chat + panel.
import type { Session, SshApprovalMode } from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'
import { useSlackStore } from '~/stores/slack'

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
// Ba điều kiện cuối lặp lại luật của SessionTodoPanel / SessionBookmarkBar / InfraChip:
// con tự ẩn chip của nó, nhưng cha phải biết TRƯỚC để không vẽ một dải 30px rỗng.
const { bannerVisible } = useSessionTodo(() => props.session)
const hasBookmarks = computed(
  () => !!props.session.loaded && (props.session.bookmarks?.length ?? 0) > 0,
)
// Hàng phải hiện khi có tool hạ tầng NÀO để bật/tắt — không chỉ khi AWS đã ghim.
// Phiên mới mặc định không ghim gì (mỗi tool một công tắc độc lập, mặc định TẮT),
// nên nếu vẫn gate theo "đã ghim AWS" thì các chip không mount được và không còn
// đường bật. `useInfraChipsPresence` đọc khả dụng máy/project một lần.
const { load: loadInfraPresence, anyVisible: hasInfra } = useInfraChipsPresence(() => props.session)
onMounted(() => void loadInfraPresence())
// Thread Slack gắn phiên (SlackThreadChip). Danh sách thread nạp lười một lần mỗi cửa
// sổ — một lần đọc file `threads.json`, không gọi Slack.
const slackStore = useSlackStore()
onMounted(() => {
  if (!slackStore.loaded) void slackStore.fetchThreads()
})
const hasSlackThread = computed(
  () =>
    !!props.session.engineId &&
    slackStore.threads.some((th) => th.sessionId === props.session.engineId),
)
const show = computed(
  () =>
    !!props.session.issueId ||
    hasSlackThread.value ||
    !!props.session.aboutTaskId ||
    !!props.session.aboutSshHostId ||
    hasInfra.value ||
    bannerVisible.value ||
    hasBookmarks.value,
)

// Một popover mở tại một thời điểm (chip SSH ở đây; chip checklist và chip đánh dấu
// tự quản popover của chúng, và backdrop của chúng cũng đóng cái này).
const open = ref<'ssh' | null>(null)
function toggle(k: 'ssh') {
  open.value = open.value === k ? null : k
}

// Neo popover SSH: fixed + kẹp viewport — chip đứng sát mép phải vẫn không tràn.
const sshPopOpen = computed(() => open.value === 'ssh')
// Chip + popover là component (Button / SessionCtxPop) ⇒ template ref là instance,
// phần tử DOM nằm ở `$el`.
const sshChipRef = useTemplateRef<{ $el: HTMLElement }>('sshChipRef')
const sshPopRef = useTemplateRef<{ $el: HTMLElement }>('sshPopRef')
const sshChipEl = computed(() => sshChipRef.value?.$el ?? null)
const sshPopEl = computed(() => sshPopRef.value?.$el ?? null)
const { style: sshPopStyle } = usePopoverAnchor(sshChipEl, sshPopEl, sshPopOpen)
</script>
