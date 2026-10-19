<template>
  <!-- `data-session-id` là NEO cho thanh chọn-văn-bản của SessionDetail (Quote /
       Copy MD / Translate). Không có nó, một selection trong ô con vẫn bị quy về phiên
       của SessionDetail: quote rơi vào composer phiên cha, và `data-mi` lại là chỉ số
       message của ô con ⇒ trích dẫn trỏ nhầm message.
       Ô của phiên cha mang viền tô primary (kiểu công tắc sáng, không phải nền). -->
  <div
    class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
    :class="primary && 'border-primary/42'"
    :data-session-id="session.id"
  >
    <!-- Header panel h-8 / chữ nhỏ; hairline bằng inset shadow (thanh cao cố định). -->
    <div
      class="flex h-8 shrink-0 items-center gap-2 px-2 text-sm shadow-[inset_0_-1px_0_var(--border)]"
    >
      <!-- Màu chấm là dữ liệu trạng thái (STATUS_COLOR), không phải màu theme. -->
      <span
        class="size-2 shrink-0 rounded-full"
        :style="{ background: statusColor }"
        :title="statusLabel"
      />
      <span class="min-w-0 flex-auto truncate font-medium" :title="session.title">
        {{ session.title }}
      </span>
      <Badge
        v-if="session.teamRole"
        variant="outline"
        class="shrink-0 border-primary/42 px-1.5 py-px font-normal text-primary"
      >
        {{ session.teamRole }}
      </Badge>
      <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ timeLabel }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        :title="t('sessions.grid.openFull')"
        :aria-label="t('sessions.grid.openFull')"
        @click="emit('openFull', session.id)"
      >
        <Icon name="external" class="size-3" />
      </Button>
      <!-- MỌI ô ẩn được, kể cả ô của phiên cha: lưới neo vào cái NHÓM (chip trên thanh)
           chứ không vào một ô cụ thể, nên không có ô nào phải ở lại. -->
      <Button
        variant="ghost"
        size="iconSm"
        class="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        :title="t('sessions.grid.hide')"
        :aria-label="t('sessions.grid.hide')"
        @click="emit('hide')"
      >
        <Icon name="x" class="size-3" />
      </Button>
    </div>

    <div class="relative flex min-h-0 flex-auto flex-col">
      <SessionTranscript
        :messages="session.msgs"
        :fallback-when="session.when"
        :loading="!!session.loading"
      />
    </div>

    <!-- ĐÚNG composer của chế độ đơn, chỉ khác là nó được trỏ vào phiên của ô này.
         Lưới là đổi CÁCH NHÌN, không phải một phiên bản rút gọn của tính năng: đính
         kèm, slash command, trích dẫn, chế độ, hàng đợi, steer — giống hệt. -->
    <SessionBackgroundWakeCard :session="session" />
    <SessionInboxChips :session="session" />
    <SessionBackgroundChips :session="session" />
    <SessionQuestionDrawer :session="session" />
    <SessionComposer
      :session-id="session.id"
      :attachments="att.pending.value"
      @send="onSend"
      @pick="openPicker"
      @remove-att="att.removeAtt"
      @add-att="att.addAtt"
      @preview="previewAtt"
      @open-more="moreOpen = true"
    />
    <!-- raw-ok: input file ẩn — chỉ để mở hộp chọn file của OS -->
    <input ref="fileInput" type="file" multiple class="hidden" @change="onPick" />
    <SessionAttachmentsModal
      :open="moreOpen"
      :attachments="att.pending.value"
      @close="moreOpen = false"
      @remove="att.removeAtt"
      @preview="previewAtt"
    />
  </div>
</template>

<script setup lang="ts">
import { QUESTION_DRAWER_KEY } from '~/composables/useSessionQuestionModal'
// MỘT ô của chế độ lưới: transcript + composer ĐẦY ĐỦ của một phiên bất kỳ.
//
// Mỗi ô tự khai một "transcript surface" của riêng nó (ADR 0075): nhiều transcript sống
// cùng lúc trên màn hình và chúng dùng chung dải `data-mi`, nên nhảy-tới-message phải
// phân giải trong ĐÚNG ô chứa nó, không phải qua `document.querySelector`.
//
// Composer nhận `sessionId` tường minh. Không có nó thì mọi composer trên màn hình đều
// đọc `store.active` và gõ vào ô nào cũng gửi cho đúng một phiên.
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import { useNow } from '~/composables/useNow'
import {
  imageSiblingsFromAttachments,
  previewRefFromAttachment,
  usePreview,
} from '~/composables/usePreview'
import { useComposerAttachments } from '~/composables/useComposerAttachments'
import { provideSessionScope } from '~/composables/useSessionScope'
import { provideTranscriptSurface } from '~/composables/useTranscriptSurface'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionsData, type Session, type SlashCommandRef } from '~/composables/useSessionsData'
import { relativeTime } from '~/utils/relative-time'

const props = defineProps<{
  session: Session
  // Ô của phiên CHA của nhóm. Chỉ để tô viền cho dễ nhận — nó ẩn được như mọi ô khác.
  primary?: boolean
}>()
const emit = defineEmits<{ hide: []; openFull: [id: number] }>()
// Ô này có ngăn kéo câu hỏi ⇒ thẻ câu hỏi trong transcript rút thành một dòng
// (useSessionQuestionModal, QUESTION_DRAWER_KEY).
provide(QUESTION_DRAWER_KEY, true)

const { t } = useI18n()
const store = useSessionsStore()
const { STATUS_COLOR } = useSessionsData()
const now = useNow()
const { open: openPreview } = usePreview()

provideTranscriptSurface()
// Ô này thuộc về phiên của nó, không phải phiên đang mở: trích dẫn, badge ① và highlight
// trong transcript đọc xuống qua đây (useSessionScope).
provideSessionScope(() => props.session.id)

// Transcript của phiên khác chỉ là summary cho tới khi ai đó nạp nó. Nạp khi ô xuất
// hiện, và nạp lại khi ô bị tái dùng cho phiên khác (lưới đổi danh sách).
onMounted(() => void store.ensureLoaded(props.session.id))
watch(
  () => props.session.id,
  (id) => void store.ensureLoaded(id),
)

const statusColor = computed(() => STATUS_COLOR[props.session.status])
const statusLabel = computed(() => t(`sessions.status.${props.session.status}`))
const timeLabel = computed(() =>
  props.session.updatedAt ? relativeTime(props.session.updatedAt, now.value) : props.session.when,
)

// Đính kèm của RIÊNG ô này (mỗi phiên một danh sách chờ).
const att = useComposerAttachments()
const moreOpen = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

function onSend(text: string, command?: SlashCommandRef) {
  void store.sendMessage(props.session.id, text, att.pending.value, command)
  att.clear()
}
function openPicker() {
  fileInput.value?.click()
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) att.addFiles(input.files)
  input.value = '' // cho phép chọn lại đúng file vừa chọn
}
function previewAtt(i: number) {
  const a = att.pending.value[i]
  if (!a) return
  // Anh em = các đính kèm đang chờ khác, để ‹ › đi đúng thứ vừa đính kèm.
  openPreview(previewRefFromAttachment(a), imageSiblingsFromAttachments(att.pending.value))
}
</script>
