<template>
  <!-- Hộp xuất · chia sẻ (mốc 6.5–6.7).
       Bản xem trước là ĐÚNG chuỗi sidecar trả về với hai công tắc đang bật — tức
       đúng thứ sẽ được ghi ra đĩa. Không có bản dựng lại ở client, và HTML của bộ
       xuất KHÔNG bao giờ đi vào DOM ở đây: nó là chuỗi để ghi ra tệp. -->
  <Teleport to="body">
    <div v-if="share.open" class="ovl on sx-ovl" @click.self="closeShare">
      <div class="sx-card" role="dialog" aria-modal="true">
        <header class="sx-head">
          <Icon name="download" class="sx-icn" />
          <span class="sx-ttl">{{ t('infra.share.title') }}</span>
          <span class="sx-subj">{{ subjectTitle }}</span>
          <button class="sx-x" type="button" :title="t('common.close')" @click="closeShare">
            <Icon name="x" class="sx-x-icn" />
          </button>
        </header>

        <!-- Tuỳ chọn: định dạng · ngôn ngữ của tệp · mẫu chia sẻ (playbook) -->
        <div class="sx-opts">
          <div class="sx-opt">
            <span class="sx-lbl">{{ t('infra.share.format') }}</span>
            <div class="seg">
              <span :class="{ on: share.format === 'markdown' }" @click="setFormat('markdown')">
                {{ t('infra.share.format.markdown') }}
              </span>
              <span :class="{ on: share.format === 'html' }" @click="setFormat('html')">
                {{ t('infra.share.format.html') }}
              </span>
            </div>
          </div>

          <div class="sx-opt">
            <span class="sx-lbl">{{ t('infra.share.lang') }}</span>
            <div class="seg">
              <span :class="{ on: share.lang === 'vi' }" @click="setLang('vi')">Tiếng Việt</span>
              <span :class="{ on: share.lang === 'en' }" @click="setLang('en')">English</span>
            </div>
          </div>

          <div v-if="isPlaybook" class="sx-opt">
            <span class="sx-lbl">{{ t('infra.share.audience.label') }}</span>
            <div class="seg">
              <span
                v-for="a in AUDIENCES"
                :key="a"
                :class="{ on: audience === a }"
                @click="setAudience(a)"
              >
                {{ t(`infra.share.audience.${a}`) }}
              </span>
            </div>
          </div>
        </div>

        <p v-if="audienceHint" class="sx-hint">
          <Icon name="info" class="sx-hint-icn" />
          {{ audienceHint }}
        </p>

        <!-- Công tắc che. Mẫu "để duyệt" BỊ BUỘC che nên công tắc khoá, không phải
             chỉ mặc định bật — người dùng phải thấy vì sao không tắt được. -->
        <div class="sx-masks">
          <div class="sx-mask">
            <span class="sx-mask-tx">{{ t('infra.share.mask.enabled') }}</span>
            <span v-if="forcedMask" class="chip sx-lock">
              <Icon name="shield" class="sx-lock-icn" />
              {{ t('infra.share.mask.forced') }}
            </span>
            <SettingsTog v-else :model-value="share.maskEnabled" @update:model-value="setMask" />
          </div>
          <div class="sx-mask">
            <span class="sx-mask-tx">{{ t('infra.share.mask.buckets') }}</span>
            <SettingsTog
              :model-value="share.bucketsDomains"
              @update:model-value="setBucketsDomains"
            />
          </div>
        </div>
        <p class="sx-note">{{ t('infra.share.mask.enabledHint') }}</p>
        <p v-if="!share.maskEnabled" class="sx-warn">
          <Icon name="alert" class="sx-warn-icn" />
          {{ t('infra.share.mask.warning') }}
        </p>

        <!-- Báo cáo: hai hành động riêng của 6.6 -->
        <div v-if="report" class="sx-report">
          <p class="sx-about">{{ t(report.aboutKey) }}</p>
          <div class="sx-report-acts">
            <button class="btn sm" type="button" @click="saveReportToWiki">
              <Icon name="book" class="sx-btn-icn" />
              {{ t('infra.share.action.wiki') }}
            </button>
            <!-- Ngoặc là bắt buộc: `scheduleReport` nhận `kind?`, nên viết trần
                 thì PointerEvent của cú bấm chui vào tham số đầu, `reportInfo()`
                 không tìm thấy loại nào và cú bấm thành im lặng. Gọi rỗng để
                 composable tự lấy loại từ đối tượng đang mở. -->
            <button class="btn sm" type="button" @click="scheduleReport()">
              <Icon name="clock" class="sx-btn-icn" />
              {{ t('infra.share.action.schedule') }}
            </button>
          </div>
        </div>

        <!-- Bản xem trước ĐÃ che -->
        <div class="sx-prev">
          <div class="sx-prev-hd">
            <span class="sx-prev-ttl">{{ t('infra.share.preview.title') }}</span>
            <span v-if="share.doc" class="sx-prev-name mono">{{ share.doc.filename }}</span>
            <span
              v-if="share.doc"
              class="chip"
              :class="share.doc.masked ? 'sx-chip-ok' : 'sx-chip-bad'"
            >
              {{
                share.doc.masked
                  ? t('infra.share.preview.masked')
                  : t('infra.share.preview.unmasked')
              }}
            </span>
            <span v-if="share.doc" class="sx-prev-bytes">
              {{ t('infra.share.preview.bytes', { n: share.doc.bytes }) }}
            </span>
          </div>

          <pre v-if="share.doc" class="sx-src mono">{{ share.doc.text }}</pre>
          <p v-else-if="share.busy" class="sx-state">{{ t('infra.share.preview.loading') }}</p>
          <p v-else class="sx-state sx-state-bad">
            {{ share.error || t('infra.share.preview.empty') }}
          </p>
          <ul v-if="share.issues.length" class="sx-issues">
            <li v-for="(msg, i) in share.issues" :key="i">{{ msg }}</li>
          </ul>

          <p class="sx-note">{{ t('infra.share.preview.snapshot') }}</p>
        </div>

        <footer class="sx-foot">
          <button class="btn sm" type="button" :disabled="!share.doc" @click="copyMarkdown">
            <Icon name="copy" class="sx-btn-icn" />
            {{ t('infra.share.action.copy') }}
          </button>
          <button class="btn sm" type="button" :disabled="!share.doc" @click="sendToChat">
            <Icon name="send" class="sx-btn-icn" />
            {{ t('infra.share.action.chat') }}
          </button>
          <button class="btn sm" type="button" :disabled="!share.doc" @click="openFullPreview">
            <Icon name="fullscreen" class="sx-btn-icn" />
            {{ t('infra.share.action.preview') }}
          </button>
          <span class="sx-gap" />
          <button class="btn sm" type="button" @click="closeShare">{{ t('common.close') }}</button>
          <button class="btn sm pri" type="button" :disabled="!share.doc" @click="saveToFile">
            <Icon name="save" class="sx-btn-icn" />
            {{ t('infra.share.action.save') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp xuất dùng chung cho ba đối tượng: một playbook (hai mẫu), một lượt chạy đã
// xong, một báo cáo. State + mọi lời gọi IPC nằm ở `useShareExport` (mọc module) nên
// hộp này chỉ bind — bên gọi chỉ cần gọi `openShare(subject)` rồi render component.
import { computed } from 'vue'
import { useShareExport } from '~/composables/useShareExport'
import type { ShareAudience } from '~/composables/useShareExport'

const { t } = useI18n()
const {
  share,
  forcedMask,
  subjectTitle,
  reportInfo,
  closeShare,
  setFormat,
  setLang,
  setMask,
  setBucketsDomains,
  setAudience,
  saveToFile,
  copyMarkdown,
  sendToChat,
  openFullPreview,
  saveReportToWiki,
  scheduleReport,
} = useShareExport()

const AUDIENCES: ShareAudience[] = ['approval', 'runbook']

const isPlaybook = computed(() => share.subject?.kind === 'playbook')

const audience = computed<ShareAudience | null>(() =>
  share.subject?.kind === 'playbook' ? share.subject.audience : null,
)

/** Báo cáo đang xuất (nếu có) — lấy từ danh mục sidecar, không tự khai ở client. */
const report = computed(() =>
  share.subject?.kind === 'report' ? reportInfo(share.subject.reportKind) : undefined,
)

// Mỗi mẫu có một lời hứa khác nhau về NỘI DUNG; nói ra ngay trên hộp chọn để người
// dùng biết mình đang gửi cái gì cho ai.
const audienceHint = computed(() => {
  const a = audience.value
  return a ? t(`infra.share.audience.hint.${a}`) : ''
})

// Trạng thái mở nằm ở MỌC MODULE (không phải `ref` của component), nên listener
// phải hỏi `share.open` chứ không thể chỉ dựa vào vòng đời của component này.
useEscToClose(
  () => share.open,
  () => closeShare(),
)
</script>

<style scoped>
.sx-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 200;
}
.sx-card {
  width: 720px;
  max-width: 94vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.sx-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.sx-icn {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--accent);
  flex: 0 0 auto;
}
.sx-ttl {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
  flex: 0 0 auto;
}
.sx-subj {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sx-x {
  flex: 0 0 auto;
  display: flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.sx-x:hover {
  color: var(--text);
}
.sx-x-icn {
  width: var(--icon-md);
  height: var(--icon-md);
}
.sx-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.sx-opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sx-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sx-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.sx-hint-icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
  margin-top: 4px;
  flex: 0 0 auto;
}
.sx-masks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.sx-mask {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sx-mask-tx {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.sx-lock {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.sx-lock-icn {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
.sx-note {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.sx-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.sx-warn-icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}
.sx-report {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.sx-about {
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.sx-report-acts {
  display: flex;
  gap: 8px;
}
.sx-prev {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.sx-prev-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sx-prev-ttl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
  flex: 0 0 auto;
}
.sx-prev-name {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textDim);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sx-prev-bytes {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
  flex: 0 0 auto;
}
.sx-src {
  flex: 1 1 auto;
  min-height: 180px;
  max-height: 46vh;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.sx-state {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sx-state-bad {
  color: var(--danger);
}
/* Chip "đã che / chưa che": lớp chip toàn cục không mang nghĩa trạng thái, và hai
   màu này phải nói được SỰ KHÁC NHAU giữa bản gửi đi và bản còn nguyên định danh. */
.sx-chip-ok {
  color: var(--green);
  border-color: var(--green);
}
.sx-chip-bad {
  color: var(--amber);
  border-color: var(--amberBorder);
}
.sx-issues {
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.sx-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sx-btn-icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.sx-gap {
  flex: 1 1 auto;
}
</style>
