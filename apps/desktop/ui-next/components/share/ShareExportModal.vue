<template>
  <!-- Hộp xuất · chia sẻ (mốc 6.5–6.7).
       Bản xem trước là ĐÚNG chuỗi sidecar trả về với hai công tắc đang bật — tức
       đúng thứ sẽ được ghi ra đĩa. Không có bản dựng lại ở client, và HTML của bộ
       xuất KHÔNG bao giờ đi vào DOM ở đây: nó là chuỗi để ghi ra tệp.
       KHÔNG dùng Dialog reka: "Xem toàn màn hình" mở PreviewModal (overlay tự viết,
       z 480) ĐÈ lên hộp này mà không đóng nó — Dialog modal của reka khoá
       pointer-events của body + bẫy focus nên PreviewModal sẽ không bấm/gõ được. -->
  <Teleport to="body">
    <!-- hook-ok: `.ovl.on` nằm trong OVERLAYS (useEmbeddedBrowser.ts); skin cũ bị utility đè hết -->
    <div v-if="share.open" :class="SCRIM" @click.self="closeShare">
      <div
        class="flex max-h-[88vh] w-180 max-w-[94vw] flex-col gap-3 rounded-xl border bg-popover p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <header class="flex min-w-0 items-center gap-2">
          <Icon name="download" class="size-4 flex-none text-primary" />
          <span class="flex-none text-lg font-semibold text-foreground">
            {{ t('infra.share.title') }}
          </span>
          <span class="min-w-0 flex-auto truncate text-sm text-dim">{{ subjectTitle }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            class="flex-none text-dim [&_svg]:size-4"
            :title="t('common.close')"
            @click="closeShare"
          >
            <Icon name="x" />
          </Button>
        </header>

        <!-- Tuỳ chọn: định dạng · ngôn ngữ của tệp · mẫu chia sẻ (playbook) -->
        <div class="flex flex-wrap gap-x-4.5 gap-y-2.5">
          <div class="flex items-center gap-2">
            <span class="text-sm text-dim">{{ t('infra.share.format') }}</span>
            <ToggleGroup
              type="single"
              :spacing="1"
              :class="SEG"
              :model-value="share.format"
              @update:model-value="(v: unknown) => v && setFormat(v as ShareFormat)"
            >
              <ToggleGroupItem value="markdown" :class="SEG_ITEM">
                {{ t('infra.share.format.markdown') }}
              </ToggleGroupItem>
              <ToggleGroupItem value="html" :class="SEG_ITEM">
                {{ t('infra.share.format.html') }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-sm text-dim">{{ t('infra.share.lang') }}</span>
            <ToggleGroup
              type="single"
              :spacing="1"
              :class="SEG"
              :model-value="share.lang"
              @update:model-value="(v: unknown) => v && setLang(v as ShareLang)"
            >
              <ToggleGroupItem value="vi" :class="SEG_ITEM">Tiếng Việt</ToggleGroupItem>
              <ToggleGroupItem value="en" :class="SEG_ITEM">English</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div v-if="isPlaybook" class="flex items-center gap-2">
            <span class="text-sm text-dim">{{ t('infra.share.audience.label') }}</span>
            <ToggleGroup
              type="single"
              :spacing="1"
              :class="SEG"
              :model-value="audience ?? undefined"
              @update:model-value="(v: unknown) => v && setAudience(v as ShareAudience)"
            >
              <ToggleGroupItem v-for="a in AUDIENCES" :key="a" :value="a" :class="SEG_ITEM">
                {{ t(`infra.share.audience.${a}`) }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <p
          v-if="audienceHint"
          class="flex items-start gap-1.5 text-sm leading-(--lh-prose) text-dim"
        >
          <Icon name="info" class="mt-1 size-3 flex-none" />
          {{ audienceHint }}
        </p>

        <!-- Công tắc che. Mẫu "để duyệt" BỊ BUỘC che nên công tắc khoá, không phải
             chỉ mặc định bật — người dùng phải thấy vì sao không tắt được. -->
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <div class="flex items-center gap-2">
            <span class="text-sm text-foreground">{{ t('infra.share.mask.enabled') }}</span>
            <Badge
              v-if="forcedMask"
              variant="outline"
              class="border-selected-border font-normal text-primary"
            >
              <Icon name="shield" />
              {{ t('infra.share.mask.forced') }}
            </Badge>
            <SettingsTog v-else :model-value="share.maskEnabled" @update:model-value="setMask" />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-foreground">{{ t('infra.share.mask.buckets') }}</span>
            <SettingsTog
              :model-value="share.bucketsDomains"
              @update:model-value="setBucketsDomains"
            />
          </div>
        </div>
        <p :class="NOTE">{{ t('infra.share.mask.enabledHint') }}</p>
        <p v-if="!share.maskEnabled" class="flex items-center gap-1.5 text-sm text-warning">
          <Icon name="alert" class="size-3.5 flex-none" />
          {{ t('infra.share.mask.warning') }}
        </p>

        <!-- Báo cáo: hai hành động riêng của 6.6 -->
        <div v-if="report" class="flex flex-col gap-2 rounded-md border px-3 py-2.5">
          <p class="text-sm leading-(--lh-prose) text-dim">{{ t(report.aboutKey) }}</p>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" :class="BTN" @click="saveReportToWiki">
              <Icon name="book" />
              {{ t('infra.share.action.wiki') }}
            </Button>
            <!-- Ngoặc là bắt buộc: `scheduleReport` nhận `kind?`, nên viết trần
                 thì PointerEvent của cú bấm chui vào tham số đầu, `reportInfo()`
                 không tìm thấy loại nào và cú bấm thành im lặng. Gọi rỗng để
                 composable tự lấy loại từ đối tượng đang mở. -->
            <Button variant="outline" size="sm" :class="BTN" @click="scheduleReport()">
              <Icon name="clock" />
              {{ t('infra.share.action.schedule') }}
            </Button>
          </div>
        </div>

        <!-- Bản xem trước ĐÃ che -->
        <div class="flex min-h-0 flex-col gap-1.5">
          <div class="flex min-w-0 items-center gap-2">
            <span class="flex-none text-sm font-medium text-foreground">
              {{ t('infra.share.preview.title') }}
            </span>
            <!-- mono: tên tệp sẽ ghi ra đĩa -->
            <span v-if="share.doc" class="min-w-0 flex-auto truncate font-mono text-xs text-dim">
              {{ share.doc.filename }}
            </span>
            <!-- "đã che / chưa che": hai màu phải nói được SỰ KHÁC NHAU giữa bản gửi đi
                 và bản còn nguyên định danh. -->
            <Badge
              v-if="share.doc"
              variant="outline"
              class="font-normal"
              :class="
                share.doc.masked ? 'border-success text-success' : 'border-warning/40 text-warning'
              "
            >
              {{
                share.doc.masked
                  ? t('infra.share.preview.masked')
                  : t('infra.share.preview.unmasked')
              }}
            </Badge>
            <span v-if="share.doc" class="flex-none text-xs text-faint tabular-nums">
              {{ t('infra.share.preview.bytes', { n: share.doc.bytes }) }}
            </span>
          </div>

          <!-- mono: nội dung tệp xuất (markdown/HTML nguồn) -->
          <pre
            v-if="share.doc"
            class="m-0 max-h-[46vh] min-h-45 flex-auto overflow-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm break-words whitespace-pre-wrap text-foreground"
            >{{ share.doc.text }}</pre
          >
          <p v-else-if="share.busy" :class="STATE">{{ t('infra.share.preview.loading') }}</p>
          <p v-else :class="cn(STATE, 'text-destructive')">
            {{ share.error || t('infra.share.preview.empty') }}
          </p>
          <ul v-if="share.issues.length" class="list-disc pl-4.5 text-xs text-warning">
            <li v-for="(msg, i) in share.issues" :key="i">{{ msg }}</li>
          </ul>

          <p :class="NOTE">{{ t('infra.share.preview.snapshot') }}</p>
        </div>

        <footer class="flex items-center gap-2">
          <Button
            :disabled="!share.doc"
            variant="outline"
            size="sm"
            :class="BTN"
            @click="copyMarkdown"
          >
            <Icon name="copy" />
            {{ t('infra.share.action.copy') }}
          </Button>
          <Button
            :disabled="!share.doc"
            variant="outline"
            size="sm"
            :class="BTN"
            @click="sendToChat"
          >
            <Icon name="send" />
            {{ t('infra.share.action.chat') }}
          </Button>
          <Button
            :disabled="!share.doc"
            variant="outline"
            size="sm"
            :class="BTN"
            @click="openFullPreview"
          >
            <Icon name="fullscreen" />
            {{ t('infra.share.action.preview') }}
          </Button>
          <span class="flex-auto" />
          <Button variant="outline" size="sm" @click="closeShare">
            {{ t('common.close') }}
          </Button>
          <Button
            :disabled="!share.doc"
            variant="default"
            size="sm"
            :class="BTN"
            @click="saveToFile"
          >
            <Icon name="save" />
            {{ t('infra.share.action.save') }}
          </Button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp xuất dùng chung cho ba đối tượng: một playbook (hai mẫu), một lượt chạy đã
// xong, một báo cáo. State + mọi lời gọi IPC nằm ở `useShareExport` (mọc module) nên
// hộp này chỉ bind — bên gọi chỉ cần gọi `openShare(subject)` rồi render component.
import { cn } from '~/lib/utils'
import { computed } from 'vue'
import { useShareExport } from '~/composables/useShareExport'
import type { ShareAudience, ShareFormat, ShareLang } from '~/composables/useShareExport'

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

// Scrim: `ovl on` chỉ còn là hook cho OVERLAYS — mọi thuộc tính hình khối của skin cũ
// (vị trí, nền, căn, padding, z) bị utility dưới đây đè. z-200: trên Git modal / sub-modal.
const SCRIM =
  'ovl on fixed inset-0 z-200 flex items-center justify-center bg-black/55 p-0 [-webkit-app-region:no-drag]'
// Segmented control (ToggleGroup) — cùng kiểu với NewTaskModal.
const SEG = 'rounded-lg bg-muted p-0.5'
const SEG_ITEM =
  'h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'
const BTN = '[&_svg]:size-3.5'
const NOTE = 'text-xs text-faint'
const STATE = 'flex min-h-45 items-center justify-center text-sm text-dim'

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
// (Esc tự xử lý vì hộp này không dựng trên Dialog reka — xem comment template.)
useEscToClose(
  () => share.open,
  () => closeShare(),
)
</script>
