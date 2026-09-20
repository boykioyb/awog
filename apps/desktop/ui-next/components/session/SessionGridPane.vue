<template>
  <!-- `data-session-id` là NEO cho thanh chọn-văn-bản của SessionDetail (Quote /
       Copy MD / Translate). Không có nó, một selection trong ô con vẫn bị quy về phiên
       của SessionDetail: quote rơi vào composer phiên cha, và `data-mi` lại là chỉ số
       message của ô con ⇒ trích dẫn trỏ nhầm message. -->
  <div class="gpane" :class="{ primary }" :data-session-id="session.id">
    <div class="gph">
      <span class="gpdot" :style="{ background: statusColor }" :title="statusLabel" />
      <span class="gptitle" :title="session.title">{{ session.title }}</span>
      <span v-if="session.groupRole" class="gprole">{{ session.groupRole }}</span>
      <span class="gpwhen">{{ timeLabel }}</span>
      <button
        class="gpib"
        :title="t('sessions.grid.openFull')"
        @click="emit('openFull', session.id)"
      >
        <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
      <!-- MỌI ô ẩn được, kể cả ô của phiên cha: lưới neo vào cái NHÓM (chip trên thanh)
           chứ không vào một ô cụ thể, nên không có ô nào phải ở lại. -->
      <button class="gpib" :title="t('sessions.grid.hide')" @click="emit('hide')">
        <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
    </div>

    <div class="gpbody">
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
    <input ref="fileInput" type="file" multiple style="display: none" @change="onPick" />
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

<style scoped>
.gpane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bg);
  overflow: hidden;
}
.gpane.primary {
  border-color: var(--accentBorder);
}
.gph {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  height: 34px;
  flex: 0 0 auto;
  box-shadow: inset 0 -1px 0 var(--border);
}
.gpdot {
  width: 7px; /* design-token-ok: chấm tròn — con số px CHÍNH LÀ hình dạng */
  height: 7px; /* design-token-ok: chấm tròn */
  border-radius: 50%;
  flex: 0 0 auto;
}
.gptitle {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gprole {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-pill);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.gpwhen {
  flex: 0 0 auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.gpib {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.gpib:hover {
  background: var(--bgHover);
  color: var(--text);
}
.gpbody {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
</style>
