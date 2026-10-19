<template>
  <!-- Teleport to body: the modal is mounted deep in the transcript subtree but
       must render as a top-level full-window overlay (escapes any ancestor
       stacking context / overflow). Single instance, driven by `item` prop or the
       shared usePreview() store. -->
  <Teleport to="body">
    <!-- hook-ok: `.ovl.on` nằm trong OVERLAYS (composables/useEmbeddedBrowser.ts) — trang web
         nhúng nhường chỗ khi preview mở; skin cũ của `.ovl` bị utility đè hết.
         Overlay tự dựng, KHÔNG dùng Dialog reka: preview được mở chồng lên chính các Dialog
         reka (ShareExportModal, modal đính kèm…), mà Dialog modal của reka khoá
         pointer-events của body ⇒ một Dialog thứ hai teleport ra body sẽ không bấm được.
         In a popout window the modal IS the window: no dim backdrop, and a click on the
         (edge-to-edge) surface must not close it — the OS chrome / header ✕ own that. -->
    <div
      v-if="shownItem"
      class="ovl on fixed inset-0 z-480 flex cursor-default justify-center [-webkit-app-region:no-drag] data-[state=open]:animate-in data-[state=open]:fade-in-0"
      :class="overlayClass"
      data-state="open"
      @click.self="onOverlayClick"
    >
      <div
        class="relative flex w-full flex-col overflow-hidden bg-background text-foreground"
        :class="cardClass"
        role="dialog"
        aria-modal="true"
        :aria-label="shownItem.name"
        :style="windowMode ? undefined : { maxWidth: modalMaxW }"
      >
        <!-- Header đè lên dải kéo cửa sổ của thanh trên ⇒ no-drag, nếu không mousedown
             lên nút sẽ khởi động kéo cửa sổ và nuốt @click. -->
        <div
          class="flex flex-none items-center gap-2 border-b px-3 py-2 text-foreground [-webkit-app-region:no-drag]"
        >
          <Button
            v-if="canGoBack"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.back')"
            :aria-label="t('common.back')"
            @click="goBack"
          >
            <Icon name="chev-left" />
          </Button>
          <Icon :name="headIcon" class="size-4 shrink-0 text-muted-foreground" />
          <!-- mono: đường dẫn file trong workspace — người dùng copy sang terminal/editor -->
          <span class="min-w-0 truncate font-mono text-sm font-medium" :title="absPath">
            {{ headerPath }}
          </span>
          <Button
            v-if="hasWorkspaceFile"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.copyPath')"
            :aria-label="t('common.preview.copyPath')"
            @click="copyPath"
          >
            <Icon name="copy" />
          </Button>
          <Button
            v-if="hasWorkspaceFile"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.reveal')"
            :aria-label="t('common.preview.reveal')"
            @click="reveal"
          >
            <Icon name="folder" />
          </Button>
          <!-- mono: "size · mime" của file -->
          <span
            v-if="meta"
            class="min-w-0 truncate font-mono text-xs text-muted-foreground tabular-nums"
          >
            {{ meta }}
          </span>
          <span
            v-if="dirty"
            class="flex-none text-xs text-warning"
            :title="t('common.preview.unsaved')"
          >
            ●
          </span>
          <Badge
            v-if="truncated"
            variant="warning"
            class="shrink-0 rounded-sm border-warning/30 font-normal whitespace-nowrap"
            :title="t('common.preview.truncated')"
          >
            {{ t('common.preview.truncated') }}
          </Badge>
          <Badge variant="secondary" class="ml-1 shrink-0">{{ shownItem.kind }}</Badge>
          <span class="flex-1" />
          <!-- Render|Raw segmented control — the header slot the proto gives markdown.
               html shares it too (same `view` state, same two modes). -->
          <ToggleGroup
            v-if="shownItem.kind === 'markdown' || shownItem.kind === 'html' || isCsv"
            type="single"
            :spacing="1"
            class="shrink-0 gap-0 border p-0.5"
            :model-value="view"
            @update:model-value="pickView"
          >
            <ToggleGroupItem
              v-for="v in VIEWS"
              :key="v"
              :value="v"
              class="h-5.5 px-2 text-xs font-normal text-muted-foreground capitalize hover:bg-transparent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            >
              {{
                isCsv
                  ? t(v === 'render' ? 'common.preview.csvTable' : 'common.preview.csvSource')
                  : t(v === 'render' ? 'common.render' : 'common.raw')
              }}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            v-if="canCopyContent"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.copy')"
            :aria-label="t('common.copy')"
            @click="copyTextContent"
          >
            <Icon
              :name="contentCopied ? 'check' : 'copy'"
              :class="{ 'text-success': contentCopied }"
            />
          </Button>
          <Button
            v-if="!windowMode"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.modalWidth', { w: modalWLabel })"
            :aria-label="t('common.preview.modalWidth', { w: modalWLabel })"
            @click="cycleModalW"
          >
            <StretchHorizontal />
          </Button>
          <Button
            v-if="canOpenInWindow"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.openInWindow')"
            :aria-label="t('common.preview.openInWindow')"
            @click="openInWindow"
          >
            <Icon name="external" />
          </Button>
          <Button
            v-if="canMinimize"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.minimize')"
            :aria-label="t('common.preview.minimize')"
            @click="minimize"
          >
            <Icon name="minimize" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <Icon name="x" />
          </Button>
        </div>

        <FindBar
          v-if="findOpen && shownItem.kind === 'markdown' && view === 'render'"
          v-model:query="findQuery"
          v-model:match-case="findMatchCase"
          :total="findMatches.length"
          :current="findMatches.length ? findCurrentIndex + 1 : 0"
          :focus-tick="findFocusTick"
          :placeholder="t('common.preview.find.placeholder')"
          @next="nextMatch"
          @prev="prevMatch"
          @close="closeFind"
        />

        <div class="relative flex flex-auto flex-col" :class="bodyLayout">
          <!-- status placeholder: workspace file loading / failed / too big / binary.
               Loading shows a spinner; the other states keep the file icon. -->
          <div v-if="statusMessage" :class="EMPTY">
            <span
              v-if="loading"
              class="size-6.5 animate-spin rounded-full border-2 border-border border-t-primary"
            />
            <Icon v-else :name="headIcon" class="size-8" />
            <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
            <div :class="EMPTY_HINT">{{ statusMessage }}</div>
          </div>

          <!-- image: zoom / pan / rotate / flip. The viewport + <img> are measured by
               fitImage() (natural size vs frame), hence the refs. Khung là absolute inset-0
               của thân (cần một hộp xác định) và cắt mọi thứ ảnh làm; KHÔNG để CSS định cỡ
               ảnh — chỉ zoom (JS, `imgStyle`) định cỡ, vì max-height % trong grid/flex không
               bao giờ có vùng xác định để bám. -->
          <div
            v-else-if="shownItem.kind === 'image' && effectiveSrc"
            ref="imgVp"
            class="absolute inset-0 cursor-grab touch-none overflow-hidden bg-muted/30 active:cursor-grabbing"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
          >
            <!-- Căn giữa sống sót khi ảnh to hơn khung: đặt wrapper ở tâm khung rồi lùi lại
                 nửa kích thước của CHÍNH nó (grid/flex sẽ "safe"-align về đầu khi item to hơn
                 container cuộn). @load: fit it to the frame once its box exists (onImageLoad). -->
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 leading-0">
              <!-- Cỡ tự nhiên — 100% là 1:1 pixel; fit/zoom/pan/xoay/lật đi qua transform. -->
              <img
                ref="imgEl"
                :src="effectiveSrc"
                class="block max-h-none max-w-none origin-center"
                :style="imgStyle"
                :alt="shownItem.name"
                @load="onImageLoad"
              />
            </div>
          </div>

          <!-- pdf: native embedded viewer (Chromium). <iframe> là replaced element: UA cho
               300×150 nên inset-0 một mình không giãn — phải size-full tường minh. -->
          <iframe
            v-else-if="shownItem.kind === 'pdf' && effectiveSrc"
            :src="effectiveSrc"
            class="absolute inset-0 size-full border-0"
            :title="shownItem.name"
          />

          <!-- video: native player. effectiveSrc streams via media:// (Range-backed,
               seekable) for workspace files, or an in-memory blob for drag-drops.
               Letterbox trên nền đen; trần 62vh trên CHÍNH thẻ video (height % ở đây không
               tin được vì thân co theo nội dung) để thanh điều khiển luôn nằm trong card. -->
          <div
            v-else-if="shownItem.kind === 'video' && effectiveSrc && !mediaError"
            class="grid min-h-0 w-full flex-auto place-items-center overflow-hidden bg-black"
          >
            <video
              :src="effectiveSrc"
              class="block max-h-[62vh] max-w-full"
              controls
              preload="metadata"
              playsinline
              @error="onMediaError"
            />
          </div>

          <!-- audio: native player centered on a file card. -->
          <div v-else-if="shownItem.kind === 'audio' && effectiveSrc && !mediaError" :class="EMPTY">
            <Icon name="play" class="size-8" />
            <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
            <audio
              :src="effectiveSrc"
              class="w-115 max-w-[80vw]"
              controls
              preload="metadata"
              @error="onMediaError"
            />
          </div>

          <!-- media unavailable: unsupported codec / decode error / no source →
               keep the toolbar (workspace files can still "open externally"). -->
          <div v-else-if="shownItem.kind === 'video' || shownItem.kind === 'audio'" :class="EMPTY">
            <Icon name="play" class="size-8" />
            <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
            <div :class="EMPTY_HINT">{{ t('common.preview.mediaError') }}</div>
          </div>

          <!-- markdown rendered: outline (TOC) sidebar + scrollable content.
               TOC thu gọn được thành rail 34px — nút collapse nằm trên hàng label,
               rail giữ nút mở lại; bản thân aside đã "sticky" (không cuộn theo
               vùng cuộn nội dung vì là sibling flex). -->
          <template v-else-if="shownItem.kind === 'markdown' && view === 'render'">
            <aside
              v-if="headings.length && !outlineCollapsed"
              class="w-60 flex-none overflow-y-auto border-r bg-muted/30 px-2 py-3.5"
            >
              <div class="flex items-center gap-1 px-1 pb-2">
                <div class="min-w-0 flex-1 px-1 text-xs font-medium text-muted-foreground">
                  {{ t('common.outline') }}
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  class="size-6 flex-none text-muted-foreground"
                  :title="t('common.preview.collapseOutline')"
                  :aria-label="t('common.preview.collapseOutline')"
                  @click="outlineCollapsed = true"
                >
                  <PanelLeftClose />
                </Button>
              </div>
              <a
                v-for="h in headings"
                :key="h.id"
                class="block cursor-pointer truncate rounded-sm py-1.5 pr-2.5 text-sm"
                :class="
                  h.id === activeHeading
                    ? 'bg-selected text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                "
                :style="{ paddingLeft: `${(h.level - 1) * 12 + 10}px` }"
                @click="goto(h.id)"
              >
                {{ h.text }}
              </a>
            </aside>
            <!-- Rail thu gọn: cả dải là nút mở lại (một đích 24px lẻ loi thì khó bấm). -->
            <Button
              v-else-if="headings.length"
              variant="ghost"
              class="h-auto w-8.5 flex-none items-start self-stretch rounded-none border-r px-0 pt-3 pb-0 text-muted-foreground [&_svg]:size-3.5"
              :title="t('common.preview.expandOutline')"
              :aria-label="t('common.preview.expandOutline')"
              @click="outlineCollapsed = false"
            >
              <PanelLeftOpen />
            </Button>
            <div
              ref="mdScroll"
              class="relative flex min-w-0 flex-1 flex-col items-center overflow-auto px-5 pt-5 pb-20"
              @scroll="onScroll"
              @mouseup="onPvSelect"
              @mousedown="onPvMouseDown"
            >
              <!-- hook-ok: `.mdbody` — prose markdown dùng chung (assets/css/markdown.css) và
                   resolvePvSelection() đọc qua closest('.mdbody') -->
              <div
                ref="mdBody"
                class="mdbody w-full max-w-220 text-foreground"
                :style="{ maxWidth: mdMaxWidth }"
                @click="onMdClick"
              >
                <template v-for="(seg, i) in segments" :key="i">
                  <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                  <pre
                    v-else-if="seg.type === 'widget'"
                    class="mmdstream"
                  ><code>{{ seg.code }}</code></pre>
                  <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
                  <div v-else v-html="seg.html" />
                </template>
              </div>
            </div>
          </template>

          <!-- docx → parsed block model rendered as a reading column -->
          <OfficeDocView v-else-if="showOfficeDoc && officeDoc" :doc="officeDoc" />

          <!-- xlsx → sheet grid + sheet tabs (fills the body, owns its scroll).
               Wrapper pins a definite box for the grid's height:100% chain —
               same collapse the code viewer solves with absolute positioning. -->
          <div v-else-if="showOfficeSheet" class="absolute inset-0">
            <OfficeSheetView :office="office" />
          </div>

          <!-- office file that parsed to nothing readable (empty doc / empty sheet) -->
          <div v-else-if="officeEmpty" :class="EMPTY">
            <Icon :name="headIcon" class="size-8" />
            <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
            <div :class="EMPTY_HINT">{{ t('common.preview.officeEmpty') }}</div>
          </div>

          <!-- .ipynb → parsed cell list (markdown / highlighted code / outputs).
               NotebookView owns its own windowing so a 500-cell notebook doesn't
               render at once. -->
          <NotebookView v-else-if="isNotebook" :source="effectiveText" :truncated="truncated" />

          <!-- html render → sandboxed, opaque-origin iframe (allow-scripts but NO
               allow-same-origin: the page's JS runs isolated, can't reach app:// or
               the parent). Relative/CDN assets won't resolve — "open in browser" is
               the full-fidelity path. `:key` re-creates the frame on reload.
               Nền trắng (mặc định trình duyệt) để trang không tự đặt nền vẫn đọc được ở
               dark mode; size-full tường minh vì iframe là replaced element. -->
          <iframe
            v-else-if="htmlRender"
            :key="htmlReloadKey"
            class="absolute inset-0 size-full border-0 bg-white"
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            :srcdoc="effectiveText"
            :title="shownItem.name"
          />

          <!-- CSV / TSV → bảng (lưới Excel dùng chung); công tắc Bảng | Mã nguồn ở header. -->
          <div v-else-if="showCsvTable" class="absolute inset-0">
            <OfficeSheetView :office="csvTable" />
          </div>

          <!-- text / markdown-raw / html-raw / code → Monaco viewer/editor (§9).
               Read-only unless edit mode is on (then `change`/`save` flow to the modal).
               Absolute inset-0: card co theo nội dung nên chiều cao thân KHÔNG xác định — một
               chuỗi `height: 100%` sẽ sập về 0 và Monaco mount vào hộp 0×0. -->
          <div v-else-if="showCode" class="absolute inset-0">
            <MonacoViewer
              ref="monacoRef"
              :value="editorValue"
              :language="monacoLang"
              :read-only="editorReadOnly"
              @change="onEditorChange"
              @save="save"
            />
          </div>

          <!-- folder: lazy file tree of the dragged working directory. Clicking a
               file repoints this modal to that file. -->
          <div
            v-else-if="shownItem.kind === 'folder'"
            class="min-h-0 flex-1 overflow-auto px-3 py-3.5"
          >
            <SessionFileTree v-if="treeRootNodes.length" :nodes="treeRootNodes" :ctrl="treeCtrl" />
            <div v-else :class="EMPTY">
              <span
                v-if="treeLoading"
                class="size-6.5 animate-spin rounded-full border-2 border-border border-t-primary"
              />
              <Icon v-else name="folder" class="size-8" />
              <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
              <div :class="EMPTY_HINT">
                {{ treeLoading ? t('sessions.preview.loading') : t('common.preview.folderEmpty') }}
              </div>
            </div>
          </div>

          <!-- image whose data could not be read, or a non-previewable file -->
          <div v-else :class="EMPTY">
            <Icon :name="shownItem.kind === 'image' ? 'clip' : 'rules'" class="size-8" />
            <div :class="EMPTY_NAME">{{ shownItem.name }}</div>
            <div :class="EMPTY_HINT">
              {{
                shownItem.kind === 'image'
                  ? t('common.preview.imageUnavailable')
                  : t('common.preview.empty')
              }}
            </div>
          </div>
        </div>

        <!-- highlight prose in a rendered markdown preview → floating action bar
             (Translate + Copy MD). Gated on the view that can actually produce a
             selection, so no state left over from a previous item can surface it over
             an image/video. Neo theo toạ độ viewport, nằm trên card nhưng dưới popover
             dịch dùng chung (teleport ra body). -->
        <div
          v-if="pvSel && shownItem.kind === 'markdown' && view === 'render'"
          class="fixed z-120 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1"
          :style="{ left: `${pvSel.x}px`, top: `${pvSel.y}px` }"
          @mousedown.prevent
        >
          <!-- Quote chỉ hiện khi bên mở là một message của session (truyền `quote`
               hook) — preview file thường không có nút này. -->
          <Button
            v-if="shownItem.quote"
            variant="outline"
            size="xs"
            :class="SEL_BTN"
            @click="onPvQuote"
          >
            <Icon name="quote" />
            {{ t('sessions.quote.action') }}
          </Button>
          <Button variant="outline" size="xs" :class="SEL_BTN" @click="onPvTranslate">
            <Icon name="globe" />
            {{ t('translate.action') }}
          </Button>
          <Button variant="outline" size="xs" :class="SEL_BTN" @click="onPvCopyMarkdown">
            <Icon :name="pvMdCopied ? 'check' : 'copy'" />
            {{ pvMdCopied ? t('common.copied') : t('common.copyMarkdown') }}
          </Button>
        </div>

        <!-- Preview trích dẫn ở góc (2026-09-15): tập trích dẫn đã ghim từ fullscreen,
             để người đọc thấy mình đã gom gì mà không phải rời màn hình. Chỉ hiện khi
             bên mở là message của session (`quote` hook) VÀ đã có ít nhất một trích dẫn.
             Neo trong card (absolute) chứ không fixed để cùng lớp với nội dung modal; trần
             chiều cao + cuộn để tập trích dẫn dài không phủ kín màn đọc. -->
        <div
          v-if="shownItem.quote && quoteEntries.length"
          class="absolute right-3.5 bottom-3.5 z-110 flex max-h-[45%] w-75 max-w-[calc(100%-1.75rem)] flex-col overflow-hidden rounded-lg border bg-popover shadow-md"
        >
          <div class="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
            <Icon name="quote" class="size-3" />
            <span>{{ t('common.preview.quotes', { n: quoteEntries.length }) }}</span>
          </div>
          <div class="flex flex-col gap-1 overflow-y-auto p-1.5">
            <div
              v-for="(q, i) in quoteEntries"
              :key="i"
              class="flex items-start gap-1.5 rounded-md border-l-2 border-ring bg-muted px-2 py-1.5"
            >
              <!-- Kẹp 3 dòng: trích dẫn dài vẫn gọn trong thẻ, không kéo panel dài ra. -->
              <span class="line-clamp-3 min-w-0 flex-1 text-sm text-foreground">
                {{ q.excerpt }}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                class="size-5 flex-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3"
                :title="t('sessions.quote.remove')"
                :aria-label="t('sessions.quote.remove')"
                @click="q.remove()"
              >
                <Icon name="x" />
              </Button>
            </div>
          </div>
        </div>

        <PreviewToolbar v-if="hasBar" :ctrl="ctrl" />

        <!-- rename / move dialog. Hộp con tự dựng (absolute trong card), không dùng Dialog
             reka: Dialog teleport ra body ở z-170 sẽ nằm DƯỚI preview (z-480). -->
        <div v-if="rename.open" :class="INNER_SCRIM" @click.self="closeRename">
          <div :class="INNER_DLG">
            <div class="font-semibold text-foreground">
              {{
                t(
                  rename.mode === 'move'
                    ? 'common.preview.moveTitle'
                    : 'common.preview.renameTitle',
                )
              }}
            </div>
            <Input
              ref="renameInput"
              v-model="rename.value"
              spellcheck="false"
              @keydown.enter="submitRename"
              @keydown.esc.stop="closeRename"
            />
            <div v-if="rename.error" class="text-sm text-destructive">{{ rename.error }}</div>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" @click="closeRename">
                {{ t('common.cancel') }}
              </Button>
              <Button size="sm" @click="submitRename">{{ t('common.confirm') }}</Button>
            </div>
          </div>
        </div>

        <!-- confirm (delete / discard unsaved edits) -->
        <div v-if="confirmReq" :class="INNER_SCRIM" @click.self="cancelConfirm">
          <div :class="INNER_DLG">
            <div class="font-semibold text-foreground">{{ t(confirmReq.titleKey) }}</div>
            <div class="text-sm text-muted-foreground">
              {{ t(confirmReq.messageKey, { name: shownItem?.name ?? '' }) }}
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" @click="cancelConfirm">
                {{ t('common.cancel') }}
              </Button>
              <Button
                size="sm"
                :variant="confirmReq.danger ? 'destructive' : 'default'"
                @click="runConfirm"
              >
                {{ t(confirmReq.confirmKey) }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// Shared, reusable preview modal — centered dialog (proto chrome) with a floating
// control bar (PreviewToolbar) and file actions. Decoupled from any feature type; callers map
// their object (e.g. SessionAttachment) into a PreviewRef. Mount once, drive with a
// nullable `item` prop or the shared usePreview() store. All state + IPC live in
// usePreviewModal (page-controller); this SFC is the thin template + styles.
//   image    → zoom / pan / rotate / flip
//   pdf      → embedded (Chromium) PDF viewer
//   markdown → rendered (marked + mermaid) with a Render/Raw toggle + outline
//   text/code→ Monaco viewer/editor (theme picker · edit · save)
//   actions  → reveal / open-in-browser / copy-path / rename / move / delete / add-to-chat
</script>

<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen, StretchHorizontal } from 'lucide-vue-next'
import MermaidView from '~/components/common/MermaidView.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import OfficeDocView from '~/components/common/OfficeDocView.vue'
import OfficeSheetView from '~/components/common/OfficeSheetView.vue'
import PreviewToolbar from '~/components/common/PreviewToolbar.vue'
import FindBar from '~/components/common/FindBar.vue'
import type { PreviewRef } from '~/composables/usePreview'
import { usePreviewModal } from '~/composables/usePreviewModal'
import { useCodeBlockControls } from '~/composables/useCodeBlockControls'
import { isInternalFileHref } from '~/utils/file-links'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'
import { loadMonaco } from '~/utils/monaco-loader'

// Backward-compatible alias: callers (e.g. SessionDetail) import `PreviewItem`.
export type PreviewItem = PreviewRef

// `item` is optional: the app-lifetime shell mount drives the modal purely from the
// shared usePreview() store (no prop); the legacy in-component mount can still pass one.
// `windowMode` is set by pages/preview.vue — the modal then fills a dedicated OS window
// (popout) instead of overlaying the app: no dim backdrop, no minimize (the OS window
// minimizes itself), no "open in window" action, and `close` closes that window.
const props = withDefaults(defineProps<{ item?: PreviewRef | null; windowMode?: boolean }>(), {
  item: null,
  windowMode: false,
})
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const ctrl = usePreviewModal(props, emit)

// Destructure stable ref/fn members so they unwrap in the template. The resolved
// item is aliased (`shownItem`) to avoid clashing with the `item` prop.
const {
  item: shownItem,
  meta,
  truncated,
  statusMessage,
  loading,
  bodyClass,
  headIcon,
  showCode,
  htmlRender,
  htmlReloadKey,
  hasBar,
  view,
  treeRootNodes,
  treeCtrl,
  treeLoading,
  segments,
  effectiveText,
  effectiveSrc,
  monacoLang,
  mediaError,
  onMediaError,
  office,
  showOfficeDoc,
  showOfficeSheet,
  isCsv,
  csvTable,
  showCsvTable,
  officeEmpty,
  editorValue,
  editorReadOnly,
  onEditorChange,
  save,
  imgStyle,
  onImageLoad,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  dirty,
  rename,
  closeRename,
  submitRename,
  confirmReq,
  runConfirm,
  cancelConfirm,
  canMinimize,
  minimize,
  canOpenInWindow,
  openInWindow,
  close,
  canGoBack,
  goBack,
  onKey,
  copyPath,
  copyContent,
  reveal,
  openLink,
  hasWorkspaceFile,
  monacoRef,
} = ctrl

// Backdrop click closes the overlay — but a popout has no backdrop to click past, so the
// same click there is just a click on the window's own surface.
function onOverlayClick() {
  if (!props.windowMode) close()
}
// Find-in-page (markdown-render). State lives in ctrl.find; destructure the refs so
// the template unwraps them (nested refs on a plain object don't auto-unwrap).
const {
  findOpen,
  query: findQuery,
  matchCase: findMatchCase,
  matches: findMatches,
  currentIndex: findCurrentIndex,
  focusTick: findFocusTick,
  nextMatch,
  prevMatch,
  closeFind,
} = ctrl.find
const { headings, activeHeading, goto, onScroll, mdMaxWidth } = ctrl.outline
// Unwrapped separately: `office` is a plain controller object, so its refs only
// unwrap in the template once bound as a top-level name.
const { doc: officeDoc } = ctrl.office

// Header shows the file's path (workspace-relative) instead of the bare name, so
// the user sees where the file lives. `absPath` is the absolute path — used for
// the tooltip and copied by the copy button (ctrl.copyPath). In-memory previews
// (no workspace file) fall back to the bare name with no copy button.
const headerPath = computed(() => {
  const it = shownItem.value
  if (!it) return ''
  return it.path || it.name
})
// .ipynb body: the cell list needs the full body width and its own left-aligned
// column, so it opts out of the body's centered prose layout. Local to the SFC —
// the controller's `bodyClass` covers the kinds it already knows about.
const isNotebook = computed(() => shownItem.value?.kind === 'notebook' && !statusMessage.value)

// ── Class khung (thuần trình bày) ────────────────────────────────────────────
// Các biến thể dưới đây đè CÙNG nhóm utility (padding / overflow / căn / min-h), nên mỗi
// nhóm chỉ nằm trong nhánh điều kiện — đặt một bản ở `class` tĩnh thì Vue nối cả hai và
// utility đứng sau trong CSS thắng, không phải cái theo điều kiện.

// Overlay: scrim mờ + card căn giữa; popout (windowMode) thì overlay CHÍNH là cửa sổ —
// không có gì phía sau để làm mờ, nên nền đặc và card tràn hết.
const overlayClass = computed(() =>
  props.windowMode ? 'items-stretch bg-background p-0' : 'items-center bg-black/55 p-6',
)
// Card: max-w-3xl · max-h-85vh · rounded-xl · viền · shadow, co theo nội dung (thân tự
// cuộn khi chạm trần 85vh). Popout: khung thuộc về cửa sổ OS nên bỏ viền/bo/bóng.
const cardClass = computed(() =>
  props.windowMode ? 'h-full' : 'max-h-[85vh] max-w-3xl rounded-xl border shadow-lg',
)
// Thân modal theo loại nội dung. `flex-auto` (basis auto, không phải 0%): card co theo
// nội dung nên nội dung ngắn cho card ngắn. pb-20 chừa chỗ dưới PreviewToolbar nổi.
const bodyLayout = computed(() => {
  const b: { flush?: boolean; mdrender?: boolean; tree?: boolean } = bodyClass.value
  // Cây thư mục: lấp thân, căn trái, cây tự cuộn.
  if (b.tree) return 'min-h-0 items-stretch overflow-hidden p-0'
  // Notebook: cột rộng hết thân, căn trái (NotebookView tự căn bề rộng đọc).
  if (isNotebook.value) return 'min-h-0 items-stretch overflow-auto px-5 pt-5 pb-20'
  if (b.mdrender) return 'min-h-0 flex-row items-stretch overflow-hidden p-0'
  // Viewer tràn mép (ảnh/pdf/iframe/Monaco/bảng) không có chiều cao nội tại — thiếu sàn
  // 60vh thì card co về còn header. Popout đã lấp cửa sổ nên bỏ sàn.
  if (b.flush)
    return `items-center overflow-hidden p-0 ${props.windowMode ? 'min-h-0' : 'min-h-[60vh]'}`
  return 'min-h-0 items-center overflow-auto px-5 pt-5 pb-20'
})
// Placeholder trạng thái (đang tải / lỗi / rỗng) + thẻ audio: cột căn giữa, chữ mờ.
const EMPTY = 'my-auto flex flex-col items-center gap-3 px-5 py-14 text-muted-foreground'
// mono: tên file — người dùng copy sang terminal/editor.
const EMPTY_NAME = 'font-mono text-sm text-foreground'
const EMPTY_HINT = 'text-sm text-muted-foreground'
// Nút của thanh hành động nổi cạnh vùng bôi đen.
const SEL_BTN =
  'gap-1.5 bg-popover px-2.5 text-sm font-normal text-popover-foreground shadow-md hover:border-ring hover:bg-popover hover:text-primary [&_svg]:size-3.5'
// Hộp đổi tên / xác nhận: scrim trong card + thẻ căn giữa.
const INNER_SCRIM = 'absolute inset-0 z-8 grid place-items-center bg-black/50'
const INNER_DLG = 'flex w-110 max-w-[90%] flex-col gap-3 rounded-lg border bg-card p-4.5 shadow-lg'

// Công tắc Render | Raw. ToggleGroup single cho phép bấm lại mục đang bật để bỏ chọn
// (giá trị rỗng) — bỏ qua để luôn có một chế độ như nút cũ.
const VIEWS = ['render', 'raw'] as const
function pickView(v: unknown) {
  if (v === 'render' || v === 'raw') view.value = v
}

const absPath = computed(() => {
  const it = shownItem.value
  if (it && hasWorkspaceFile.value && it.workspaceRoot && it.path) {
    return `${it.workspaceRoot.replace(/[/\\]+$/, '')}/${it.path}`
  }
  return headerPath.value
})

// Nút copy content ở header (theo proto): chỉ hiện khi có text để copy — text/
// markdown/html/notebook qua effectiveText; docx/xlsx chiếu text từ model đã
// parse (copyContent của ctrl tự chọn nguồn đúng, kể cả TSV cho sheet).
const canCopyContent = computed(() => {
  const it = shownItem.value
  if (!it || statusMessage.value) return false
  if (it.kind === 'doc' || it.kind === 'sheet') return !!(office.doc.value || office.sheet.value)
  return !!effectiveText.value
})
// Độ rộng modal — header có nút cycle qua các preset (0 = tràn khung nhìn).
// Inline maxWidth trên card ghi đè `max-w-3xl` (768px); popout
// (windowMode) không áp vì card lúc đó chính là OS window.
const MODAL_W = [880, 1180, 0] as const
const modalWIdx = ref(1)
const modalWLabel = computed(() =>
  MODAL_W[modalWIdx.value] === 0 ? t('common.full') : `${MODAL_W[modalWIdx.value]}px`,
)
const modalMaxW = computed(() => {
  const w = MODAL_W[modalWIdx.value]
  return w === 0 ? 'calc(100vw - 40px)' : `min(${w}px, calc(100vw - 40px))`
})
function cycleModalW() {
  modalWIdx.value = (modalWIdx.value + 1) % MODAL_W.length
}

// Mục lục của markdown render — thu gọn thành rail mỏng khi cần chỗ đọc.
const outlineCollapsed = ref(false)

const contentCopied = ref(false)
let contentCopiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyTextContent() {
  await Promise.resolve(copyContent())
  contentCopied.value = true
  if (contentCopiedTimer) clearTimeout(contentCopiedTimer)
  contentCopiedTimer = setTimeout(() => {
    contentCopied.value = false
  }, 1200)
}

// Intercept clicks on links inside the rendered markdown preview. An internal
// workspace/relative path would otherwise send the SPA router to a dead route
// (404 → "Go back home" nukes the session), so open it in THIS modal instead —
// matching how a file path opens from the transcript (SessionMarkdownHtml). External
// URLs (http(s)/mailto/tel) and in-page anchors (#…) keep their default behaviour.
function onMdClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  const href = (a.getAttribute('href') ?? '').trim()
  if (!isInternalFileHref(href)) return // external URL / #anchor → default handling
  e.preventDefault()
  openLink(href)
}

// Copy button on every code block of the rendered markdown — same control the transcript
// shows. v-html owns those nodes, so the buttons are (re)attached whenever the segments
// change (utils/code-block-controls is idempotent).
const mdBody = useTemplateRef<HTMLElement>('mdBody')
useCodeBlockControls(mdBody, () => segments.value)

// Focus the rename/move input when its dialog opens.
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')
watch(
  () => rename.open,
  (open) => {
    if (open) nextTick(() => renameInput.value?.focus())
  },
)

// Warm the (heavy) Monaco bundle in the background as soon as a code-capable file
// opens, so switching into the code / raw view doesn't pay the first-load cost.
watch(
  shownItem,
  (it) => {
    if (it && (it.kind === 'text' || it.kind === 'markdown' || it.kind === 'html'))
      void loadMonaco()
  },
  { immediate: true },
)

// Selection-to-translate on the rendered markdown prose (no project → app-default
// LLM). Only the `.mdbody` render surface participates; the raw/Monaco/HTML-iframe
// views have their own selection models and are out of scope.
const translate = useSelectionTranslate()
const pvSel = ref<{ text: string; x: number; y: number } | null>(null)

function resolvePvSelection(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = node instanceof HTMLElement ? node : node.parentElement
  if (!el?.closest('.mdbody')) return null
  return { text, rect: range.getBoundingClientRect() }
}
function onPvSelect(e: MouseEvent) {
  if (e.button !== 0) return
  pvMdCopied.value = false
  const r = resolvePvSelection()
  pvSel.value = r ? { text: r.text, x: r.rect.left + r.rect.width / 2, y: r.rect.top - 8 } : null
}
function onPvMouseDown(e: MouseEvent) {
  if (e.button === 0) pvSel.value = null
}
// The trigger is STATE, not a live read of the selection, and this modal is an
// app-lifetime singleton — so a button left over from one item would float above
// the next one (a stale "Translate" over a video was the symptom). Drop it whenever
// the shown item changes and at every open/close boundary; the mousedown handler
// only fires inside the markdown scroller, so it can't cover closing from the
// header or stepping through a gallery.
const { openEpoch } = usePreview()
watch([shownItem, openEpoch], () => {
  pvSel.value = null
  pvMdCopied.value = false
})
function onPvTranslate() {
  const s = pvSel.value
  if (!s) return
  const sel = window.getSelection()
  const rect =
    sel && sel.rangeCount > 0
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { left: s.x, top: s.y, bottom: s.y, width: 0 }
  translate.open(s.text, rect)
  pvSel.value = null
}

// Copy MD → the RAW markdown behind the highlighted prose (utils/selection-markdown maps
// the rendered selection back onto the file's source text), so a copied excerpt keeps its
// headings/fences/tables instead of arriving flattened. The bar stays up showing "Copied";
// it clears on the next click/selection or when the shown item changes.
const pvMdCopied = ref(false)
let pvMdCopiedTimer: ReturnType<typeof setTimeout> | null = null
async function onPvCopyMarkdown() {
  const s = pvSel.value
  if (!s) return
  const md = rawMarkdownForSelection([effectiveText.value], s.text) ?? s.text
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    return // clipboard denied — leave the bar up so the user can copy manually
  }
  pvMdCopied.value = true
  if (pvMdCopiedTimer) clearTimeout(pvMdCopiedTimer)
  pvMdCopiedTimer = setTimeout(() => {
    pvMdCopied.value = false
  }, 1400)
}

// Quote → ghim đoạn bôi đen thành một trích dẫn qua hook mà bên mở truyền vào
// (SessionMessageItem). Modal không biết gì về session; nó chỉ gọi `add` rồi bỏ
// selection. Panel preview ở góc (`quoteEntries`) hiện ngay khoản vừa thêm — đó
// chính là phản hồi, nên không cần cờ "đã thêm" riêng.
function onPvQuote() {
  const s = pvSel.value
  const hook = shownItem.value?.quote
  if (!s || !hook) return
  hook.add(s.text)
  pvSel.value = null
}

// Tập trích dẫn để vẽ ở góc. `list()` đọc thẳng nguồn reactive (session.followups)
// nên computed này tự chạy lại khi thêm/xoá trích dẫn.
const quoteEntries = computed(() => shownItem.value?.quote?.list() ?? [])

// Let the shared translation popover consume ESC first (it closes itself); only
// then does ESC close the preview. Preview mounts before the popover, so this
// guard runs before the popover's own ESC handler on the common case.
function onKeyGuarded(e: KeyboardEvent) {
  if (e.key === 'Escape' && translate.active.value) return
  onKey(e)
}
onMounted(() => window.addEventListener('keydown', onKeyGuarded))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyGuarded))
</script>

<style scoped>
/* style-ok: prose markdown render ra qua v-html (DOM của nội dung, class không chạm tới được) —
   bản riêng của preview đè lên assets/css/markdown.css (h1 có gạch chân, link màu primary,
   code/pre nền muted). */
/* ── rendered markdown prose (v-html content → :deep) ─────────────────── */
/* Ảnh link ngoài bị chặn trong file chỉ-xem (usePreviewModal blockRemoteImages). */
.mdbody :deep(.pv-img-blocked) {
  display: inline-block;
  padding: 2px 8px;
  border: 1px dashed var(--border);
  border-radius: var(--r-xs);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.mdbody {
  width: 100%;
  max-width: 880px;
  line-height: var(--lh-prose);
  color: var(--foreground);
}
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
  /* design-token-ok: heading font-size is em-relative (ADR 0079 leaves `em` alone), so
     no single whole-pixel leading exists for the whole h1…h6 group. */
  line-height: 1.3;
  margin: 1.1em 0 0.5em;
}
.mdbody :deep(h1) {
  font-size: 1.6em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}
.mdbody :deep(h2) {
  font-size: 1.35em;
}
.mdbody :deep(h3) {
  font-size: 1.15em;
}
.mdbody :deep(p),
.mdbody :deep(ul),
.mdbody :deep(ol),
.mdbody :deep(blockquote),
.mdbody :deep(table) {
  margin: 0.6em 0;
}
.mdbody :deep(ul),
.mdbody :deep(ol) {
  padding-left: 1.5em;
}
/* Tailwind Preflight resets list-style to none — restore markers for prose lists. */
.mdbody :deep(ul) {
  list-style: disc;
}
.mdbody :deep(ol) {
  list-style: decimal;
}
.mdbody :deep(li) {
  margin: 0.2em 0;
}
.mdbody :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.mdbody :deep(code) {
  /* mono-ok: inline code in the markdown render */
  font-family: var(--code);
  font-size: 0.9em;
  background: var(--muted);
  padding: 1px 5px;
  border-radius: var(--r-xs); /* rounded-sm */
}
.mdbody :deep(pre) {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  padding: 12px 14px;
  overflow-x: auto;
  line-height: var(--lh-sm);
}
.mdbody :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.mdbody :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--muted-foreground);
}
.mdbody :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.mdbody :deep(th),
.mdbody :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.mdbody :deep(th) {
  background: var(--muted);
}
.mdbody :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1.2em 0;
}
.mdbody :deep(img) {
  max-width: 100%;
}
/* Code token colors come from Shiki inline styles (ADR 0055). */
</style>
