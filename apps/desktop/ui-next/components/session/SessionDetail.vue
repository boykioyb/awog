<template>
  <div
    class="detail sdrow"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Header (proto ProtoSessionDetail parity): một hàng 44px không wrap —
         title → status badge → ⓤ agent · model → spacer → bubble toggle →
         workspace toggle → ⋯ DropdownMenu. Mọi hành động hiếm (project/config/
         grid/CLI/spawn/code/popout/minimize/export/delete) nằm sau ⋯; điều
         khiển sống của pane CLI (sync/detach/font/back) vẫn là nút thường trực
         khi pane đang mở.

         Cũng gỡ luôn nhánh `v-if="!isCute"` / `v-else`: file từng mang HAI bản markup
         cho cùng bốn hành động (4 iconbtn cho family `awog`, menu `⋯` cho `cute`).
         Bản `⋯` giờ là bản duy nhất, cho cả hai family. -->
    <!-- Dock TRÁI + PHẢI là anh em của cột chính, KHÔNG nằm trong nó: chúng chạy
         hết chiều cao khung, còn header phiên chỉ trải trên cột chat — mô hình
         sidebar của VS Code / Linear. Trước đây cả hai nằm trong `.chatwrap`, nên
         panel bắt đầu dưới header và chừa một dải chết ở đỉnh.

         Dock DƯỚI ở lại trong cột chính: nó nằm dưới chat, không chui xuống dưới
         hai panel bên — đúng như bottom panel của VS Code. -->
    <template v-if="wpOpen && leftTabs.length">
      <SessionWorkspacePanel
        :session="session"
        dock="left"
        :tabs="leftTabs"
        :active="activeLeft"
        :size="wpLeftWidth"
        :addable-views="addableViews"
        @close="closeSide('left')"
        @set-active="activeLeft = $event"
        @close-tab="closeTab"
        @add-view="(v) => addView(v, 'left')"
        @move-dock="moveDock"
      />
      <div
        class="rszwp"
        :class="{ drag: wpDragging }"
        @pointerdown="(e) => onWpResize(e, 'left')"
      />
    </template>

    <div class="sdmain">
      <div class="dh">
        <!-- ProtoSessionDetail header order: title → status badge → agent · model
             (icon ~12px) → spacer (.dt flex-1) → workspace toggle → ⋯ overflow. -->
        <div class="dt">
          <span class="dttitle" :title="session.title">{{ session.title }}</span>
          <Badge :variant="statusVariant" class="dhbadge">{{ statusLabel }}</Badge>
          <span class="dhwho" :title="whoLabel">
            <UserRound class="size-3 shrink-0" />
            <span class="dhwhotext">{{ whoLabel }}</span>
          </span>
        </div>

        <!-- Bubble toggle (proto `MessagesSquare`): production bubbles user rows
             permanently — the pref điều khiển khối card của reply assistant
             (settings.sessions.assistantBubble, cùng một nút trong Settings →
             Sessions). Toggle trực tiếp, không menu. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="dhb shrink-0"
          :class="{ on: settings.sessions.assistantBubble }"
          :title="t('settings.sessions.bubble.name')"
          :aria-label="t('settings.sessions.bubble.name')"
          :aria-pressed="settings.sessions.assistantBubble"
          @click="settings.sessions.assistantBubble = !settings.sessions.assistantBubble"
        >
          <Icon name="message" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </Button>

        <!-- Views. Điều khiển duy nhất ở ngoài, vì nó là thứ được bấm nhiều lần trong
             một phiên; mở/tắt từng khung làm việc, khung đang mở có dấu tick. -->
        <span class="dhanchor">
          <Button
            variant="ghost"
            size="iconSm"
            class="dhb shrink-0"
            :class="{ on: wpOpen || menu === 'workspace' }"
            :title="t('sessions.detail.workspacePanel')"
            :aria-label="t('sessions.detail.workspacePanel')"
            @click.stop="openMenu('workspace')"
          >
            <Icon name="workflows" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <div
            v-if="menu === 'workspace'"
            class="smenu"
            style="position: absolute; top: 130%; right: 0; z-index: 50"
            @click.stop
          >
            <div v-for="v in ALL_VIEWS" :key="v" class="mi" @click="toggleView(v)">
              <Icon :name="wpIcon(v)" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ v }}
              <Icon
                v-if="openViews.includes(v)"
                name="check"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </div>
          </div>
        </span>

        <!-- Điều khiển CLI pane — chỉ hiện khi cliMode đang mở (pane bỏ thanh
             riêng, các nút sống ở đây theo ghi chú layout). Thứ tự giữ như thanh
             cũ: Sync · Ngắt · Cỡ/font · Về chat. `.dh` không wrap nên header chỉ
             co tiêu đề. -->
        <template v-if="cliMode">
          <Button
            variant="ghost"
            size="iconSm"
            class="dhb shrink-0"
            :disabled="cliSyncing"
            :title="t('sessions.cli.syncHint')"
            :aria-label="t('sessions.cli.syncHint')"
            @click="syncCliTranscript"
          >
            <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="dhb shrink-0"
            :disabled="cliDetaching"
            :title="t('sessions.cli.detachHint')"
            :aria-label="t('sessions.cli.detachHint')"
            @click="detachCli"
          >
            <Icon name="stop" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="dhb shrink-0"
            :title="t('ssh.appearance.title')"
            :aria-label="t('ssh.appearance.title')"
            @click="cliPane?.toggleAppearance?.()"
          >
            <Icon name="palette" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="dhb shrink-0"
            :title="t('sessions.cli.backToChat')"
            :aria-label="t('sessions.cli.backToChat')"
            @click="cliMode = false"
          >
            <Icon name="message" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
        </template>

        <!-- Overflow ⋯ — DropdownMenu chuẩn shadcn (proto parity): mọi hành động
             hiếm/phá transcript nằm sau nó. Hai submenu `.smenu` (`proj` · `config`)
             vẫn neo vào span này, nên mở menu con từ trong ⋯ không cần thêm điểm neo. -->
        <span class="dhanchor">
          <DropdownMenu v-model:open="ddOpen">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="iconSm"
                class="dhb shrink-0"
                :class="{ on: ddOpen || menu === 'proj' || menu === 'config' }"
                :title="t('sessions.detail.moreActions')"
                :aria-label="t('sessions.detail.moreActions')"
              >
                <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem @click="openMenu('proj')">
                <Icon name="folder" />
                <span class="min-w-0 flex-1 truncate">
                  {{ t('sessions.detail.changeProject') }}
                </span>
                <span class="ml-auto max-w-28 truncate text-xs text-muted-foreground">
                  {{ projName }}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openMenu('config')">
                <Icon name="settings" />
                {{ t('sessions.detail.config') }}
              </DropdownMenuItem>
              <!-- Lưới: phiên này + các phiên con, mỗi phiên một ô. Nằm TRONG `⋯` chứ
                   không phải một nút thường trực — header cố ý chỉ có tiêu đề + meta +
                   đúng hai điều khiển; nút thứ ba làm hàng nút xuống dòng và tràn khỏi
                   thanh cao cố định. -->
              <DropdownMenuItem @click="toggleGrid">
                <Icon name="layers" />
                {{ gridMode ? t('sessions.grid.off') : t('sessions.grid.on') }}
                <Icon v-if="gridMode" name="check" class="ml-auto text-primary" />
              </DropdownMenuItem>
              <!-- "Open in CLI": pane xterm chạy agent CLI thật trong workspace, thay
                   chỗ transcript + composer. Chỉ hiện khi phiên có CLI native
                   (anthropic/openai + engineId + sidecar) — xem canOpenInCli. -->
              <DropdownMenuItem v-if="canOpenInCli" @click="toggleCli">
                <Icon name="commands" />
                {{ cliMode ? t('sessions.cli.backToChat') : t('sessions.cli.open') }}
                <Icon v-if="cliMode" name="check" class="ml-auto text-primary" />
              </DropdownMenuItem>
              <!-- Điều phối phiên con THỦ CÔNG — cùng popover với cổng duyệt của
                   tool create_session, nhưng do người dùng đề xuất ê-kíp. -->
              <DropdownMenuItem @click="spawnDlg.open(session.id)">
                <Icon name="sessions" />
                {{ t('sessions.spawn.menu') }}
              </DropdownMenuItem>
              <!-- Ẩn khi chưa resolve được workspace root (browser-dev / phiên không project). -->
              <DropdownMenuItem v-if="codeRoot" @click="openInCode">
                <Icon name="code" />
                {{ t('sessions.detail.openCode') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <!-- Ẩn khi đang ở trong popout (một cửa sổ không tự nhân bản), khoá giữa
                   lượt đang chạy: lượt stream vào renderer NÀY nên không bàn giao được. -->
              <DropdownMenuItem v-if="canOpenInWindow" :disabled="turnBusy" @click="openInWindow">
                <Icon name="external" />
                {{ popoutTitle }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="minimizeSession">
                <Icon name="minimize" />
                {{ t('minimize.session') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="exportModal.open(session.id)">
                <Icon name="save" />
                {{ t('sessions.export.title') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:bg-destructive/10 focus:text-destructive"
                @click="askRemove"
              >
                <Icon name="trash" />
                {{ t('sessions.detail.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div
            v-if="menu === 'proj'"
            class="smenu"
            style="position: absolute; top: 130%; right: 0; z-index: 50"
            @click.stop
          >
            <div v-for="p in projects" :key="p.id" class="mi" @click="selectProj(p.id)">
              {{ p.name }}
              <Icon
                v-if="p.id === session.project"
                name="check"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </div>
          </div>

          <SessionConfigPopover
            v-if="menu === 'config'"
            :session="session"
            style="position: absolute; top: 130%; right: 0; z-index: 50"
            @click.stop
          />
        </span>
      </div>

      <!-- chat + right-docked panel share a row (.wptop); the bottom-docked panel
           stacks full-width beneath them. Right and bottom are independent panel
           instances so e.g. Terminal (bottom) and Files (right) coexist. -->

      <!-- chat + dock dưới xếp chồng trong cột chính. -->
      <div class="chatwrap">
        <div class="wptop">
          <div
            class="chat"
            @mouseup="onSelectQuote"
            @mousedown="onChatMouseDown"
            @contextmenu="onQuoteContextMenu"
          >
            <!-- Cute family only (spec §13): a brief "Done!" celebration when a turn
                 finishes. `.chat` is its positioned ancestor (below) so it floats over
                 the top of the conversation without shifting layout. -->
            <SessionDoneFlash v-if="isCute" :status="session.status" />
            <!-- Hàng ngữ cảnh gộp (session-ui-refactor §3.2): task · host SSH + mức
                 duyệt · checklist · đánh dấu trên MỘT dòng thay vì tối đa sáu hàng
                 banner chồng nhau.

                 Nằm TRONG `.chat`, không phải anh em của `.chatwrap`: ở ngoài nó trải
                 ngang cả cột detail — tính luôn phần nằm trên workspace panel — nên
                 panel bị đẩy xuống và để lại một dải chết ở đỉnh. Đây cũng đúng chỗ
                 cũ của SessionTodoPanel / SessionBookmarkBar mà nó thay thế. -->
            <SessionContextStrip :session="session" />
            <!-- Find-in-session (⌘/Ctrl+F): floats over the top-right of the chat column,
                 left of the transcript's fold-all button, so nothing shifts when it opens. -->
            <div v-if="findOpen" class="findwrap">
              <FindBar
                v-model:query="findQuery"
                v-model:match-case="findMatchCase"
                :total="findTotal"
                :current="findCurrent"
                :status="findStatus"
                :focus-tick="findFocusTick"
                :placeholder="t('sessions.find.placeholder')"
                @next="findNext"
                @prev="findPrev"
                @close="closeFind"
              />
            </div>
            <!-- Pane CLI ("Open in CLI"): một xterm chạy agent CLI thật trong
                 workspace, thay chỗ bề mặt chat. Mount MỘT LẦN rồi chỉ v-show —
                 unmount là kill PTY, mà "quay lại chat" không được làm mất shell
                 đang chạy. Đứng NGOÀI nhánh grid/transcript để bật/tắt lưới cũng
                 không đụng tới vòng đời của nó. -->
            <SessionCliPane
              v-if="cliMounted"
              v-show="cliMode"
              ref="cliPane"
              :session="session"
              :active="cliMode && isActive"
              @linked="onCliLinked"
            />
            <!-- Chế độ LƯỚI: phiên này + các phiên con, mỗi phiên một ô có transcript
                 và composer riêng. Thay CHỖ của transcript + composer đơn, không nằm
                 cạnh — hai composer cho cùng một phiên trên một màn hình là mơ hồ. -->
            <SessionGrid
              v-if="gridMode"
              v-show="!cliMode"
              :session="session"
              :reveal-tick="gridRevealTick"
            />
            <SessionTranscript
              v-else
              v-show="!cliMode"
              :messages="session.msgs"
              :fallback-when="session.when"
              :loading="!!session.loading"
              :suppress-auto-scroll="findOpen"
            />
            <SessionBackgroundWakeCard v-if="!gridMode && !cliMode" :session="session" />
            <SessionInboxChips v-if="!gridMode && !cliMode" :session="session" />
            <SessionBackgroundChips v-if="!gridMode && !cliMode" :session="session" />
            <!-- Câu hỏi của agent (AskUserQuestion) trượt lên từ composer, ngay trên nó,
                 nên người dùng không phải đi tìm thẻ trong transcript đang cuộn. -->
            <SessionQuestionDrawer v-if="!gridMode && !cliMode" :session="session" />
            <!-- Phiên đang gắn một CLI (PTY còn sống, pane chỉ đang ẩn): composer bị
                 khoá — gõ ở đây sẽ không tới được CLI. Dòng báo gọn kiểu `.cmdnotice`
                 + nút Sync gấp tin phía CLI vào transcript ngay tại chỗ. -->
            <div v-if="cliLinked && !gridMode && !cliMode" class="clinotice">
              <Icon
                name="commands"
                style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto"
              />
              <span class="clinoticetxt">
                {{
                  cliEngineLinked
                    ? t('sessions.cli.attachedNotice')
                    : t('sessions.cli.attachedNoticeUnlinked')
                }}
              </span>
              <!-- Notice bảo "chuyển sang pane CLI" — nút này làm đúng việc đó
                   thay vì bắt người dùng đi vòng qua menu ⋯. -->
              <button class="clinoticebtn" @click="cliMode = true">
                {{ t('sessions.cli.open') }}
              </button>
              <button class="clinoticebtn" :disabled="cliSyncing" @click="syncCliTranscript">
                {{
                  cliSyncing
                    ? t('sessions.cli.syncing')
                    : cliSyncedN == null
                      ? t('sessions.cli.syncNow')
                      : t('sessions.cli.synced', { n: cliSyncedN })
                }}
              </button>
              <!-- "Ngắt CLI": kill PTY từ ngay đây — lối thoát khỏi composer bị
                   khoá không cần mở pane gõ `exit`. Engine (onExit) dọn link +
                   import transcript; nút Sync còn lại thì chỉ để gấp tin GIỮA
                   chừng trong lúc CLI còn sống. -->
              <button
                class="clinoticebtn"
                :disabled="cliDetaching"
                :title="t('sessions.cli.detachHint')"
                @click="detachCli"
              >
                {{ cliDetaching ? t('sessions.cli.detaching') : t('sessions.cli.detach') }}
              </button>
            </div>
            <SessionComposer
              v-if="!gridMode && !cliMode"
              :attachments="pendingAtt"
              :disabled="cliLinked"
              @send="onSend"
              @pick="openPicker"
              @remove-att="removeAtt"
              @add-att="onAddAtt"
              @preview="previewAtt"
              @open-more="moreOpen = true"
            />
          </div>
        </div>
        <template v-if="wpOpen && bottomTabs.length">
          <div
            class="rszwp vert"
            :class="{ drag: wpDragging }"
            @pointerdown="(e) => onWpResize(e, 'bottom')"
          />
          <SessionWorkspacePanel
            :session="session"
            dock="bottom"
            :tabs="bottomTabs"
            :active="activeBottom"
            :size="wpHeight"
            :addable-views="addableViews"
            @close="closeSide('bottom')"
            @set-active="activeBottom = $event"
            @close-tab="closeTab"
            @add-view="(v) => addView(v, 'bottom')"
            @move-dock="moveDock"
          />
        </template>
      </div>
    </div>

    <template v-if="wpOpen && rightTabs.length">
      <div
        class="rszwp"
        :class="{ drag: wpDragging }"
        @pointerdown="(e) => onWpResize(e, 'right')"
      />
      <SessionWorkspacePanel
        :session="session"
        dock="right"
        :tabs="rightTabs"
        :active="activeRight"
        :size="wpWidth"
        :addable-views="addableViews"
        @close="closeSide('right')"
        @set-active="activeRight = $event"
        @close-tab="closeTab"
        @add-view="(v) => addView(v, 'right')"
        @move-dock="moveDock"
      />
    </template>

    <!-- Hidden picker behind the composer's clip button -->
    <input ref="fileInput" type="file" multiple style="display: none" @change="onPick" />

    <!-- Drop anywhere on the detail to attach (pointer-events:none so drop/leave fire on .detail) -->
    <div v-if="dragActive" class="dropzone">
      <div class="dropzone-inner">
        <Icon name="clip" style="width: 22px; height: 22px" />
        {{ t('sessions.composer.dropHint') }}
      </div>
    </div>

    <!-- Select (highlight) text in a message → floating action bar (Quote + Translate + Copy MD) -->
    <div
      v-if="quoteSel"
      class="selactions"
      :style="{ '--sel-x': `${quoteSel.x}px`, '--sel-y': `${quoteSel.y}px` }"
      @mousedown.prevent
    >
      <!-- Quote chỉ khi selection nằm TRONG một message (cần neo `src`). Ngoài
           message (AskQuestion, step log…) thì chỉ còn Translate + Copy MD. -->
      <button v-if="quoteSel?.src != null" class="selquote" @click="openNote">
        <Icon name="quote" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('sessions.quote.action') }}
      </button>
      <button class="selquote" @click="onTranslate">
        <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('translate.action') }}
      </button>
      <button class="selquote" @click="onCopyMarkdown">
        <Icon
          :name="mdCopied ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ mdCopied ? t('common.copied') : t('common.copyMarkdown') }}
      </button>
    </div>

    <!-- note popover for a selection quote -->
    <template v-if="notePop">
      <div class="notebackdrop" />
      <div
        class="notepop"
        :class="{ moved: notePos, dragging: notePopDragging }"
        :style="notePopStyle"
        @mousedown.stop
      >
        <div class="npq" @pointerdown="onNoteDragStart">
          <Icon name="quote" style="width: var(--icon-xs); height: var(--icon-xs)" />
          <span class="npex">{{ notePop.text }}</span>
        </div>
        <textarea
          ref="noteInput"
          v-model="noteText"
          class="npinput"
          rows="3"
          :placeholder="t('sessions.quote.notePlaceholder')"
          @keydown.enter.exact.prevent="saveQuote"
          @keydown.enter.meta.prevent="saveQuote"
          @keydown.enter.ctrl.prevent="saveQuote"
        />
        <div class="nprow">
          <button class="npbtn" @click="notePop = null">{{ t('common.close') }}</button>
          <button class="npbtn pri" @click="saveQuote">{{ t('sessions.quote.save') }}</button>
        </div>
        <div class="npresize" @pointerdown="onNoteResizeStart" />
      </div>
    </template>

    <div v-if="menu" style="position: fixed; inset: 0; z-index: 40" @click="menu = null" />

    <SessionAttachmentsModal
      :open="moreOpen"
      :attachments="pendingAtt"
      @close="moreOpen = false"
      @remove="removeAtt"
      @preview="previewAtt"
    />
  </div>
</template>

<script setup lang="ts">
// Session detail (renderDetail ~1342): header (project chip, context bar, config
// chip, info/workspace/delete buttons) + chat (todo · transcript · composer) and
// the optional workspace panel. Context bar math mirrors ctxHtml (~1287); the
// usage + config popovers reuse the `.dproj` dropdown pattern (one menu open at a
// time via `menu`, closed by a fixed full-screen backdrop). Data flows through
// useSessionsStore (remove/setProject/sendMessage) — visual rates are presentational.
import type { Session, SlashCommandRef } from '~/composables/useSessionsData'
import { PROVIDER_DISPLAY } from '~/composables/useSessionsData'
import { UserRound } from 'lucide-vue-next'
import type { UnlistenFn } from '~/composables/useSidecar'
import type { WorkspaceDockSide } from '~/stores/settings'
import {
  imageSiblingsFromAttachments,
  previewRefFromAttachment,
  usePreview,
} from '~/composables/usePreview'
import { useMinimizeDock } from '~/composables/useMinimizeDock'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { wpIcon } = useSessionsData()
const { projects, projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()
const exportModal = useSessionExportModal()
const spawnDlg = useSessionSpawnDialog()
const translate = useSelectionTranslate()
const { isCute } = useThemeFamily()

// Whether THIS instance is the one currently shown. Under <KeepAlive> (pages/sessions
// caches recent detail instances so switching back is instant) inactive instances stay
// mounted, so effects that touch app-wide singletons — the chatAttach consumer and the
// workspace footer bridge — gate on this. Otherwise every cached session would drain
// the same "add to chat" queue and react to the footer's view toggles at once.
const isActive = computed(() => props.session.id === store.activeId)

// Resolve this session's workspace root once and provide a file opener so file
// paths in chat markdown (e.g. `docs/x.md`) open in the shared PreviewModal.
provideFilePreview(
  () => props.session.project,
  () => props.session,
)
// Bare "comment <id>" refs in the transcript resolve against THIS session's
// project repo (session.project carries the projectId).
provideGhCommentLink(() => props.session.project)

// This detail is a transcript "surface": jump callers underneath it (follow-up
// anchors, the composer's quote cards) resolve to the SessionTranscript rendered
// here, not to a same-session copy docked in a hidden SSH tab (ADR 0075).
// The returned ref is kept because the find bar lives in THIS component: `inject`
// resolves from the PARENT's provides, so a provider can never inject its own entry —
// it hands the ref to useSessionFind instead.
const transcriptSurface = provideTranscriptSurface()
// Phiên của bề mặt này (xem useSessionScope). Ở chế độ LƯỚI mỗi ô tự khai đè lên nó.
provideSessionScope(() => props.session.id)

// ── Jump to a message asked for from OUTSIDE this surface ────────────────────
// Cross-session search lives in the list column, a SIBLING of this one, so it cannot
// inject the transcript surface (ADR 0075) — it parks the anchor in the store and the
// surface owner (this component) picks it up. `scrollToMessage` already owns the whole
// two-step contract of ADR 0074 §Q2: grow the render window (`reveal`, the transcript
// only mounts the last few turns), then query inside THIS transcript's root and flash
// the row in accent. So there is nothing to do about `windowStart` here.
const { scrollToMessage } = useSessionScroll(transcriptSurface)

// Popout hand-off: exactly one renderer owns a session, and the window that doesn't
// renders a placeholder instead of a transcript. It must never swallow the anchor.
const ownsThisSession = computed(() => !store.isHandedOff(props.session.engineId))

// The consumed anchor, held here until the transcript can actually serve it. The
// store slot is cleared on the FIRST look (read-and-clear) so a pending jump can never
// get stuck there — waiting for the transcript happens locally, on a leash.
const jumpEid = ref<string | null>(null)
let jumpTimer: ReturnType<typeof setTimeout> | undefined
// Longest we keep waiting for the transcript to arrive before telling the user it did
// not (a failed `sessions.get` leaves `loaded` false forever — silence there would read
// as "the app ignored my click").
const JUMP_WAIT_MS = 8000

function clearJump() {
  jumpEid.value = null
  if (jumpTimer) clearTimeout(jumpTimer)
  jumpTimer = undefined
}

// Take the anchor as soon as it is addressed to this session AND this instance is the
// one on screen. `immediate` matters: the list sets the anchor BEFORE this detail
// mounts for a session opened for the first time, so a change-only watcher would never
// see it. Gated on `isActive` because <KeepAlive> keeps other sessions' instances alive
// and reacting; gated on ownership because of the popout hand-off.
watch(
  [() => store.pendingJump, isActive, ownsThisSession],
  () => {
    if (!isActive.value || !ownsThisSession.value) return
    const eid = store.consumeMessageJump(props.session.id)
    if (!eid) return
    jumpEid.value = eid
    if (jumpTimer) clearTimeout(jumpTimer)
    jumpTimer = setTimeout(() => {
      if (!jumpEid.value) return
      clearJump()
      useToast().add({ title: t('sessionsSearch.jump.failed'), color: 'error' })
    }, JUMP_WAIT_MS)
  },
  { immediate: true },
)

// Resolve it once the transcript is both loaded (the message may simply not be in
// `msgs` yet — reporting "not found" before that is a lie) and mounted (no registered
// transcript ⇒ every jump returns 'not-found').
watch(
  [jumpEid, () => props.session.loaded, () => props.session.msgs.length, transcriptSurface],
  async () => {
    const eid = jumpEid.value
    if (!eid || !props.session.loaded || !transcriptSurface.value) return
    // Resolve through `eid` and nothing else: a miss NEVER falls back to a neighbouring
    // index (ADR 0074 §Q1) — landing on the wrong message is the one outcome this
    // feature may not produce.
    const i = props.session.msgs.findIndex((m) => m.eid === eid)
    clearJump()
    if (i < 0) {
      useToast().add({ title: t('sessionsSearch.jump.notFound'), color: 'error' })
      return
    }
    // The transcript re-windows + scrolls to the bottom on (re)activation; let that
    // settle so the deliberate jump is the LAST scroll, not the one that gets undone.
    await nextTick()
    if (transcriptSurface.value && (await scrollToMessage(i)) !== 'ok')
      useToast().add({ title: t('sessionsSearch.jump.failed'), color: 'error' })
  },
  { flush: 'post' },
)

onBeforeUnmount(clearJump)

// Header trash → confirm before dropping the session (destructive, no undo).
async function askRemove() {
  const ok = await confirm({
    title: t('sessions.delete.title'),
    description: t('sessions.delete.one', { title: props.session.title }),
  })
  if (ok) store.remove(props.session.id)
}

// Link "phiên này về cái gì" (ADR 0055 task · ADR 0064 host SSH) + checklist +
// đánh dấu đã chuyển sang SessionContextStrip — chúng là một lý do thay đổi riêng.

// Per-session SSH tool approval mode (ADR 0064 P2). Governs the agent's mutating
// SSH tools (ssh_exec / ssh_write_file); 'prompt' by default. Takes effect on the
// next turn (engine reads it per turn).

// Single popover open at a time (project switcher · config · workspace — the ⋯
// overflow is a self-managed DropdownMenu, outside this union). The shared
// backdrop closes whichever is open.
type Menu = 'proj' | 'config' | 'workspace'
const menu = ref<Menu | null>(null)
function openMenu(m: Menu) {
  menu.value = menu.value === m ? null : m
}
// ⋯ overflow DropdownMenu open state — drives the trigger's "on" highlight only
// (reka closes the menu itself on select / click-away / Esc).
const ddOpen = ref(false)

// Header meta (proto parity): status Badge + "agent · model" who-line. Agent = the
// AWOG member id when the session belongs to a team (session.agent), else the
// provider display name — the proto's harness slot ('claude', 'codex', …).
const STATUS_BADGE = {
  idle: 'outline',
  streaming: 'default',
  awaiting: 'warning',
  done: 'secondary',
  error: 'destructive',
} as const
const statusVariant = computed(() => STATUS_BADGE[props.session.status])
const statusLabel = computed(() => t(`sessions.status.${props.session.status}`))
const whoLabel = computed(() => {
  const agent = props.session.agent?.id ?? PROVIDER_DISPLAY[store.providerOf(props.session)] ?? ''
  return [agent, props.session.model].filter(Boolean).join(' · ')
})

// Project switcher (the `.dproj` crumb): the crumb shows the resolved project NAME
// (session.project holds the engine projectId); selecting persists the id.
const projName = computed(() => projectName(props.session.project))

// Header "Open in VS Code" → the session's project folder, resolved the same way the
// workspace tabs resolve it (name-or-id → path). Falls back to the OS file manager when
// `code` isn't on PATH; no-op in browser-dev.
const sc = useSidecar()
const { root: codeRoot } = useWorkspaceData(() => props.session.project)
async function openInCode() {
  const root = codeRoot.value
  if (!root || !sc.available) return
  try {
    if (await sc.isVscodeAvailable()) await sc.openInVscode(root, '.')
    else await sc.openPath(root, '.')
  } catch (err) {
    console.warn('[sessions] open in code failed', err)
  }
}
function selectProj(id: string) {
  store.setProject(props.session.id, id)
  menu.value = null
}

// Composer send → the store's turn runner (IPC).
// Pending attachments ride along, then clear (new array so the sent copy is safe).
function onSend(text: string, command?: SlashCommandRef) {
  // Folder attachments ride into the user message (bubble) and, via the store, to
  // the turn's `contextFolders` (read-only <workspace_tree> context). They do NOT
  // set the session cwd — the tools' working dir stays the project/home.
  store.sendMessage(props.session.id, text, pendingAtt.value, command)
  pendingAtt.value = []
}

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
// Pane CLI expose toggleAppearance (drawer cỡ/font) — nút Aa trên header gọi vào.
const cliPane = useTemplateRef<{ toggleAppearance?: () => void }>('cliPane')

// Đính kèm đang chờ của composer này. Logic dựng attachment (ảnh/PDF → data URL, file
// chữ → nội dung, còn lại → tham chiếu path) nằm ở `useComposerAttachments` vì chế độ
// LƯỚI có composer thứ hai cần đúng nó — hai bản chép tay sẽ trôi khỏi nhau, mà cái
// trôi đi là "file có tới được model không".
const att = useComposerAttachments()
const pendingAtt = att.pending
const addFiles = att.addFiles
const removeAtt = att.removeAtt
const onAddAtt = att.addAtt

// "Add file to chat" from the global PreviewModal arrives via the decoupled
// useChatAttach channel (the modal must not know about sessions — SoC). Register
// this open session view as the consumer and drain queued attachments into the
// composer's pending list.
const chatAttach = useChatAttach()
let unregisterChatAttach: (() => void) | null = null
// Only the active instance registers as the attach consumer and drains the queue, so a
// cached (backgrounded) session never steals the "add to chat" attachment.
watch(
  isActive,
  (active) => {
    if (active && !unregisterChatAttach) unregisterChatAttach = chatAttach.registerConsumer()
    else if (!active && unregisterChatAttach) {
      unregisterChatAttach()
      unregisterChatAttach = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  unregisterChatAttach?.()
  unregisterChatAttach = null
})
watch(
  () => chatAttach.queue.value.length,
  (n) => {
    if (n > 0 && isActive.value) pendingAtt.value.push(...chatAttach.drain())
  },
)
function openPicker() {
  fileInput.value?.click()
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files)
  input.value = '' // allow re-picking the same file
}

// "+N more" overflow list modal (composer caps inline chips).
const moreOpen = ref(false)

// Selection-to-quote: highlight text in a message → floating Quote button → a note
// popover; on Save the selection is marked (coloured + numbered) in place.
// `src` null = selection nằm ngoài một message (AskQuestion, step log…): Translate +
// Copy MD vẫn dùng được, chỉ Quote (cần neo message) là ẩn.
// `sid` = phiên SỞ HỮU đoạn vừa bôi đen. Ở chế độ đơn luôn là phiên này; ở chế độ LƯỚI
// nó là phiên của Ô người dùng bôi đen, đọc từ `[data-session-id]` mà SessionGridPane
// gắn. Thiếu nó thì quote đi vào composer phiên cha còn `src` lại là chỉ số message của
// ô con — hai toạ độ khác hệ quy chiếu.
type SelQuote = { text: string; src: number | null; sid: number; x: number; y: number }
const quoteSel = ref<SelQuote | null>(null)
const notePop = ref<SelQuote | null>(null)
const noteText = ref('')
const noteInput = ref<HTMLTextAreaElement | null>(null)

// Note popover drag/resize state (AN-2). When the user drags the header or resizes,
// we switch from selection-anchored (`transform: translate(-50%,-100%)`) to explicit
// top-left coords + fixed size. Ephemeral — reset to defaults each time it opens.
const NOTE_POP_DEFAULT_WIDTH = 280
const NOTE_POP_MIN_WIDTH = 240
const NOTE_POP_MIN_HEIGHT = 160
const NOTE_POP_MARGIN = 16
const NOTE_POP_EDGE = 8
const notePos = ref<{ x: number; y: number } | null>(null)
const noteSize = ref<{ w: number; h: number } | null>(null)
const notePopDragging = ref(false)
// Teardown for an in-flight note drag/resize gesture. Set on each gesture start,
// invoked (and cleared) on pointerup and on unmount — so listeners + pointer capture
// don't leak if the popover tears down mid-drag (session switch, keyboard save, etc.).
let activeNoteCleanup: (() => void) | null = null

// Once moved/resized, anchor by explicit top-left (drop the selection-anchored
// transform) so drag coords map intuitively; otherwise use the selection anchor.
const notePopStyle = computed<Record<string, string>>(() => {
  const np = notePop.value
  if (!np) return {}
  const size = noteSize.value
  const w = size ? `${size.w}px` : `${NOTE_POP_DEFAULT_WIDTH}px`
  const h = size ? `${size.h}px` : ''
  const pos = notePos.value
  if (pos) return { left: `${pos.x}px`, top: `${pos.y}px`, width: w, ...(h ? { height: h } : {}) }
  return { left: `${np.x}px`, top: `${np.y}px`, width: w }
})

// Auto-focus the note textarea once the popover mounts (AN-1). The HTML `autofocus`
// attribute only fires on the initial page load, but `.notepop` is inserted
// dynamically via v-if — so focus it manually each time it opens, caret at the end.
function focusNoteInput() {
  nextTick(() => {
    const el = noteInput.value
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  })
}

// Validate the current selection lives inside the transcript column (.chat) and
// extract its text + source message index (if any) + bounding rect. Returns null
// when there is no valid selection. Shared by the mouseup (onSelectQuote) and
// right-click (onQuoteContextMenu) triggers.
//
// `src` là `number | null` (mở rộng 2026-09-15): Translate + Copy MD phải chạy cho
// MỌI text trong session — kể cả card AskQuestion, log step, plan card — không chỉ
// trong bong bóng message. Chỉ Quote cần điểm neo message (`[data-mi]`), nên khi
// selection nằm ngoài message thì `src = null` và nút Quote tự ẩn (Translate + Copy
// MD vẫn hiện). Vẫn phải nằm trong `.chat` để không bật thanh này cho selection ở
// composer / popover / modal khác.
function resolveSelectionQuote(): {
  text: string
  src: number | null
  sid: number
  rect: DOMRect
} | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const startEl = node instanceof HTMLElement ? node : node.parentElement
  if (!startEl?.closest('.chat')) return null
  const msgEl = startEl.closest('[data-mi]')
  const src = msgEl instanceof HTMLElement ? Number(msgEl.dataset.mi) : null
  // Ô lưới gần nhất; không có ⇒ chế độ đơn ⇒ phiên của chính view này.
  const paneEl = startEl.closest('[data-session-id]')
  const paneSid = paneEl instanceof HTMLElement ? Number(paneEl.dataset.sessionId) : NaN
  const sid = Number.isFinite(paneSid) ? paneSid : props.session.id
  return { text, src, sid, rect: range.getBoundingClientRect() }
}

// mouseup: anchor the floating Quote button to the top-centre of the selection.
// Guard to left-click only — right-click also fires `mouseup` (button=2) after
// `contextmenu`, which would otherwise overwrite the cursor-anchored position set by
// `onQuoteContextMenu` and make the button jump back (AN-3).
function onSelectQuote(e: MouseEvent) {
  if (e.button !== 0) return
  const q = resolveSelectionQuote()
  if (!q) {
    quoteSel.value = null
    return
  }
  mdCopied.value = false
  quoteSel.value = {
    text: q.text,
    src: q.src,
    sid: q.sid,
    x: q.rect.left + q.rect.width / 2,
    y: q.rect.top - 8,
  }
}

// Right-click (AN-3): show the Quote button at the cursor. Only prevent the default
// context menu when there is a valid selection inside a message — otherwise leave the
// platform menu intact. Ignored while the note popover is already open.
function onQuoteContextMenu(e: MouseEvent) {
  if (notePop.value) return
  const q = resolveSelectionQuote()
  if (!q) return
  e.preventDefault()
  mdCopied.value = false
  quoteSel.value = { text: q.text, src: q.src, sid: q.sid, x: e.clientX, y: e.clientY }
}

// Left-click clears the floating Quote button; right-click must NOT clear it, or it
// would wipe `quoteSel` before `contextmenu` re-sets it (mousedown fires first).
function onChatMouseDown(e: MouseEvent) {
  if (e.button === 0) quoteSel.value = null
}
// Quote button → open the note popover at the same spot (keeps the captured range).
function openNote() {
  if (!quoteSel.value) return
  notePop.value = { ...quoteSel.value }
  noteText.value = ''
  quoteSel.value = null
  // No persist: reset to default (selection-anchored, default width, auto height).
  notePos.value = null
  noteSize.value = null
  notePopDragging.value = false
  focusNoteInput()
}
// Translate button → open the shared translation popover anchored to the live
// selection rect (`@mousedown.prevent` on the action bar keeps the range alive).
// LLM defaults resolve from the session's project (→ app defaults).
function onTranslate() {
  const q = quoteSel.value
  if (!q) return
  const sel = window.getSelection()
  const rect =
    sel && sel.rangeCount > 0
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { left: q.x, top: q.y, bottom: q.y, width: 0 }
  // Ngôn ngữ/LLM mặc định resolve theo project của phiên SỞ HỮU đoạn đó.
  const owner =
    q.sid === props.session.id ? props.session : store.sessions.find((s) => s.id === q.sid)
  translate.open(q.text, rect, owner?.project ?? props.session.project)
  quoteSel.value = null
}

// Copy MD → the RAW markdown behind the highlighted text, not the flattened text the
// browser would put on the clipboard (utils/selection-markdown maps the rendered
// selection back onto this message's markdown source). The bar stays open showing
// "Copied" so the feedback is where the user just clicked; it clears on the next
// click/selection like the other two actions.
const mdCopied = ref(false)
let mdCopiedTimer: ReturnType<typeof setTimeout> | null = null

// Markdown sources the selection could have come from, in match order. An assistant turn
// keeps its text runs as separate blocks (intermediate commentary + the final response),
// and only ONE of them contains the selection — rawMarkdownForSelection takes the first
// that matches. A user/system message is a single raw string.
function selectionSources(mi: number, sid: number): string[] {
  // Markdown gốc phải lấy từ transcript của ĐÚNG phiên đã bôi đen: `mi` là chỉ số
  // trong transcript ĐÓ, nên đọc nhầm phiên là copy ra markdown của một message khác.
  const owner = sid === props.session.id ? props.session : store.sessions.find((s) => s.id === sid)
  const m = owner?.msgs[mi]
  if (!m) return []
  return m.role === 'assistant'
    ? m.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : []))
    : [m.text]
}

async function onCopyMarkdown() {
  const q = quoteSel.value
  if (!q) return
  // Ngoài message (src null) không có nguồn markdown để ánh xạ ngược → copy thẳng
  // text đã bôi đen. Trong message thì map về markdown gốc như cũ.
  const md =
    q.src != null
      ? (rawMarkdownForSelection(selectionSources(q.src, q.sid), q.text) ?? q.text)
      : q.text
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    return // clipboard denied — leave the bar up so the user can copy manually
  }
  mdCopied.value = true
  if (mdCopiedTimer) clearTimeout(mdCopiedTimer)
  mdCopiedTimer = setTimeout(() => {
    mdCopied.value = false
  }, 1400)
}

// Drag the popover by its header. Native pointer + setPointerCapture (mirrors
// onWpResize). Switches to top-left anchoring; keeps `noteText` (no textarea remount).
function onNoteDragStart(ev: PointerEvent) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  const pop = handle.closest('.notepop') as HTMLElement | null
  if (!pop) return
  handle.setPointerCapture(ev.pointerId)
  notePopDragging.value = true
  const box = pop.getBoundingClientRect()
  // Anchor to current top-left so the popover doesn't jump when switching modes.
  if (!notePos.value) notePos.value = { x: box.left, y: box.top }
  if (!noteSize.value) noteSize.value = { w: box.width, h: box.height }
  const grabX = ev.clientX - notePos.value.x
  const grabY = ev.clientY - notePos.value.y
  const onMove = (e: PointerEvent) => {
    const w = noteSize.value?.w ?? box.width
    const h = noteSize.value?.h ?? box.height
    const maxX = window.innerWidth - w - NOTE_POP_EDGE
    const maxY = window.innerHeight - h - NOTE_POP_EDGE
    notePos.value = {
      x: Math.max(NOTE_POP_EDGE, Math.min(maxX, e.clientX - grabX)),
      y: Math.max(NOTE_POP_EDGE, Math.min(maxY, e.clientY - grabY)),
    }
  }
  const cleanup = () => {
    notePopDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId)
    if (activeNoteCleanup === cleanup) activeNoteCleanup = null
  }
  const onUp = () => cleanup()
  activeNoteCleanup = cleanup
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

// Resize the popover via the bottom-right handle. Clamp width [240, min(560, vw−16)]
// and height [160, vh−16].
function onNoteResizeStart(ev: PointerEvent) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  const pop = handle.closest('.notepop') as HTMLElement | null
  if (!pop) return
  handle.setPointerCapture(ev.pointerId)
  notePopDragging.value = true
  const box = pop.getBoundingClientRect()
  if (!notePos.value) notePos.value = { x: box.left, y: box.top }
  if (!noteSize.value) noteSize.value = { w: box.width, h: box.height }
  const startX = ev.clientX
  const startY = ev.clientY
  const startW = noteSize.value.w
  const startH = noteSize.value.h
  const onMove = (e: PointerEvent) => {
    const maxW = Math.min(WP_SIDE.max, window.innerWidth - NOTE_POP_MARGIN)
    const maxH = window.innerHeight - NOTE_POP_MARGIN
    const w = Math.max(NOTE_POP_MIN_WIDTH, Math.min(maxW, startW + (e.clientX - startX)))
    const h = Math.max(NOTE_POP_MIN_HEIGHT, Math.min(maxH, startH + (e.clientY - startY)))
    noteSize.value = { w, h }
    // Re-clamp the top-left so growing near the right/bottom edge doesn't push the
    // popover (and its Save button) off-screen. Keep it fully inside the viewport.
    const pos = notePos.value ?? { x: box.left, y: box.top }
    const maxX = window.innerWidth - w - NOTE_POP_EDGE
    const maxY = window.innerHeight - h - NOTE_POP_EDGE
    notePos.value = {
      x: Math.max(NOTE_POP_EDGE, Math.min(maxX, pos.x)),
      y: Math.max(NOTE_POP_EDGE, Math.min(maxY, pos.y)),
    }
  }
  const cleanup = () => {
    notePopDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId)
    if (activeNoteCleanup === cleanup) activeNoteCleanup = null
  }
  const onUp = () => cleanup()
  activeNoteCleanup = cleanup
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}
// Tear down a live note drag/resize gesture if the component unmounts mid-drag, so the
// captured pointer + document listeners don't leak (mirrors the composer/tab cleanup).
onBeforeUnmount(() => activeNoteCleanup?.())

// ESC closes the note popover even when focus isn't inside its textarea (drag handle,
// a button, the backdrop). Gated on `isActive` so a cached <KeepAlive> instance that
// still holds an open popover (session switched away without closing it) can't swallow
// ESC for the session now on screen.
useEscToClose(
  () => isActive.value && !!notePop.value,
  () => {
    notePop.value = null
  },
)
// Find in session (docs/features/session-transcript-navigation.md §A2). Declared AFTER
// the note popover's useEscToClose so its Esc listener registers later and yields to the
// popover; ⌘/Ctrl+F, the highlight and the loading state all live in the composable.
const {
  findOpen,
  query: findQuery,
  matchCase: findMatchCase,
  total: findTotal,
  current: findCurrent,
  status: findStatus,
  focusTick: findFocusTick,
  closeFind,
  nextMatch: findNext,
  prevMatch: findPrev,
} = useSessionFind({
  session: () => props.session,
  surface: transcriptSurface,
  isActive: () => isActive.value,
})

// Save → add the follow-up (with note). The in-place highlight is painted reactively by
// SessionTextBlock via the CSS Custom Highlight API once the follow-up lands in state, so
// there's no DOM mutation here (which would otherwise strip the rendered markdown).
function saveQuote() {
  const np = notePop.value
  // src null không tới được đây (nút Quote ẩn ngoài message), nhưng addQuote cần một
  // chỉ số message — chặn tường minh thay vì ép kiểu.
  if (!np || np.src == null) return
  // Quote đi vào phiên SỞ HỮU đoạn được bôi đen, không phải phiên của view này — ở
  // chế độ lưới hai thứ đó khác nhau.
  store.addQuote(np.sid, np.src, np.text, noteText.value.trim())
  window.getSelection()?.removeAllRanges()
  notePop.value = null
  noteText.value = ''
}

// Shared preview modal (mounted app-wide in the shell) — map an attachment into
// the generic PreviewRef shape and open the shared viewer.
const { open: openPreview } = usePreview()
function previewAtt(i: number) {
  const a = pendingAtt.value[i]
  if (!a) return
  // Siblings = the other pending attachments, so ‹ › walks what the user just attached
  // (these have no folder on disk to fall back to).
  openPreview(previewRefFromAttachment(a), imageSiblingsFromAttachments(pendingAtt.value))
}

// Minimize this session to the corner dock as a live PiP tile (keeps tracking its
// status while the user works elsewhere; click the pill to jump back).
const { minimize: dockMinimize } = useMinimizeDock()
function minimizeSession() {
  dockMinimize({
    id: `session:${props.session.id}`,
    kind: 'session',
    icon: 'sessions',
    title: props.session.title,
    sessionId: props.session.id,
  })
}

// Move this session to its own OS window (docs/features/session-popout-window.md).
// Only a session the sidecar knows about can go: the popout is a fresh renderer that
// re-reads the transcript from disk and addresses the session by its ENGINE id (the
// numeric client id is per-renderer). Hidden inside a popout — `windowSessionId` is
// set only there — so a window can't clone itself.
const canOpenInWindow = computed(
  () => sc.available && !store.windowSessionId && !!props.session.engineId,
)
// A turn in flight streams into THIS renderer's copy of the message, so handing the
// session over mid-turn would strand it. Wait for the turn (or cancel it) first.
const turnBusy = computed(
  () => props.session.status === 'streaming' || props.session.status === 'awaiting',
)
// Nhãn của hành động popout trong menu ⋯ — đổi giữa "Mở cửa sổ" / "lượt đang bận"
// theo turnBusy (disabled state đi kèm nó ở DropdownMenuItem).
const popoutTitle = computed(() =>
  turnBusy.value ? t('sessions.window.busy') : t('sessions.window.open'),
)
function openInWindow() {
  if (turnBusy.value) return
  void store.openInWindow(props.session.id)
}

// Drag-drop file attach — the WHOLE detail is the drop target (not just the
// composer). A depth counter survives dragenter/leave bubbling from children so
// the overlay doesn't flicker; reset on drop.
const dragDepth = ref(0)
const dragActive = computed(() => dragDepth.value > 0)
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
function onDragEnter(e: DragEvent) {
  if (hasFiles(e)) dragDepth.value++
}
function onDragOver(e: DragEvent) {
  if (hasFiles(e) && e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  if (dragDepth.value > 0) dragDepth.value--
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  const dt = e.dataTransfer
  if (!dt) return
  // `dt.items` carries the folder/file distinction (webkitGetAsEntry); `dt.files`
  // does not. Read synchronously — the list is only valid during this event. Files
  // AND folders can be dropped together (multi-file, multi-folder): folders become
  // read-only <workspace_tree> context chips; everything else is a file attachment.
  const items = Array.from(dt.items)
  if (items.length) {
    const droppedFiles: File[] = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        const path = file ? (window.awog?.getPathForFile?.(file) ?? '') : ''
        if (!path || pendingAtt.value.some((a) => a.folder && a.path === path)) continue
        const name =
          path
            .replace(/[/\\]+$/, '')
            .split(/[/\\]/)
            .pop() || path
        pendingAtt.value.push({ name, img: false, folder: true, path })
      } else if (file) {
        droppedFiles.push(file)
      }
    }
    if (droppedFiles.length) addFiles(droppedFiles)
    return
  }
  if (dt.files.length) addFiles(dt.files)
}

// Workspace panel: dock side is configured per VIEW (Settings store). Open views
// are partitioned by their dock side into two independent panel instances — a
// right-docked one (resizes horizontally) and a bottom-docked one (vertically) —
// which coexist, so e.g. Terminal (bottom) stays put while you browse Files
// (right). Sizes persist per orientation in the store.
const settings = useSettingsStore()
const wpOpen = ref(false)

// ⚠ Danh sách này là thứ QUYẾT ĐỊNH view nào mở được, không phải `WPVIEWS` trong
// useSessionsData (cái đó chỉ cấp icon + phím tắt). Thêm view mà quên thêm vào đây
// thì component có tồn tại cũng không có đường nào bấm tới.

// ── "Open in CLI" (pane CLI) ─────────────────────────────────────────────────
// Chế độ anh em của gridMode: một pane xterm chiếm chỗ transcript + composer,
// chạy CLI agent THẬT trong workspace của phiên qua sessions.openCli (PTY gom
// dưới khoá `cli:<engineId>`). Bốn mảnh trạng thái tách vai:
//   cliMode        — pane đang HIỆN (thay chỗ transcript);
//   cliMounted     — pane đã từng được mở → giữ mount mãi, chỉ v-show ẩn/hiện —
//                    unmount là kill PTY, và "quay lại chat" không được làm mất shell;
//   cliLinked      — một PTY CLI còn sống → khoá composer + hiện notice (+ Sync
//                    + Detach). Engine chặn sendMessage trên MỌI link sống —
//                    kể cả devin unlinked — nên cờ này theo "PTY sống", không
//                    theo cờ engine-linked;
//   cliEngineLinked — cờ `res.linked` THẬT pane báo về (native resume đúng phiên
//                    / devin mở phiên riêng) → chỉ để chọn copy notice.
// cliTerminalId    — terminalId PTY CLI nếu renderer này biết (pane emit →
//                    terminal.list, khôi phục lúc mount, event terminal.data):
//                    đối chiếu terminal.exit và dự phòng cho detach.
const cliApi = useTerminalApi()
const cliMode = ref(false)
const cliMounted = ref(false)
const cliLinked = ref(false)
const cliEngineLinked = ref(true)
let cliTerminalId: string | null = null
// Phiên có CLI native để gắn: engine phải biết nó (engineId — phiên chưa gửi tin
// nào chưa persist) và provider của nó có CLI tương ứng (anthropic → claude,
// openai → codex). Pi/Google/browser-dev không offer — mục menu ẩn hẳn.
const canOpenInCli = computed(
  () =>
    sc.available &&
    !!props.session.engineId &&
    ['anthropic', 'openai'].includes(store.providerOf(props.session)),
)
function toggleCli() {
  cliMode.value = !cliMode.value
  if (cliMode.value) {
    cliMounted.value = true
    // CLI thay chỗ cả LƯỚI (một pane toàn cột) — bật nó là thu lưới về đơn.
    // toggleGrid() giữ đúng nghi thức "quên tick reveal" khi lưới đóng.
    if (gridMode.value) toggleGrid()
  }
}
// Một nhịp sessions.syncCli: engine gấp tin mới phía CLI vào JSONL của phiên
// (hàng nhập về mang `via`), rồi transcript nạp lại. Đường này phục vụ CẢ nút
// Sync của notice lẫn nhịp ngầm lúc đóng pane; `reloadTranscript` tự khử trùng
// với nhánh reload qua event `session.cli-synced` mà engine bắn sau mỗi sync.
const cliSyncing = ref(false)
// Số tin vừa nhập, hiện thoáng qua trên nút Sync của notice.
const cliSyncedN = ref<number | null>(null)
let cliSyncedTimer: ReturnType<typeof setTimeout> | undefined
const CLI_SYNCED_SHOW_MS = 3000
async function syncCliTranscript() {
  const eid = props.session.engineId
  if (!eid || !sc.available || cliSyncing.value) return
  cliSyncing.value = true
  try {
    const res = await cliApi.syncCli(eid)
    cliSyncedN.value = res.imported
    if (cliSyncedTimer) clearTimeout(cliSyncedTimer)
    cliSyncedTimer = setTimeout(() => {
      cliSyncedN.value = null
    }, CLI_SYNCED_SHOW_MS)
  } catch (err) {
    // Engine build cũ chưa có sessions.syncCli, hoặc phiên bận — vẫn cố nạp lại,
    // transcript có thể đã thay đổi qua đường khác.
    console.warn('[sessions] syncCli failed', err)
  } finally {
    cliSyncing.value = false
  }
  store.reloadTranscript(props.session.id)
}
// Quay về chat (cliMode true→false) = một nhịp sync ngầm — tin người dùng vừa
// gõ trong CLI phải sẵn sàng hiện trên transcript mà không cần bấm Sync.
watch(cliMode, (on, was) => {
  if (was && !on) void syncCliTranscript()
})
// Học terminalId của PTY CLI đang sống từ registry (attach mới, remount, hoặc
// respawn-race đều đi qua đây). Chỉ cập nhật `cliTerminalId` — cờ cliLinked do
// luồng gọi quyết, đừng để một nhịp list lỗi hạ khoá composer oan.
async function learnCliTerminal(): Promise<void> {
  const eid = props.session.engineId
  if (!eid || !sc.available) return
  try {
    const res = await cliApi.list(`cli:${eid}`)
    cliTerminalId = res.terminals[0]?.terminalId ?? null
  } catch {
    // terminal.list chưa có / engine cũ — detach sẽ list lại lúc bấm.
  }
}
// Pane emit { attached, linked }: `attached` = PTY sống → khoá/mở composer;
// `linked` = cờ engine (native resume vs devin phiên riêng) → chọn copy notice.
function onCliLinked(state: { attached: boolean; linked: boolean }) {
  cliLinked.value = state.attached
  // Gỡ attach → trả copy về mặc định; một PTY học qua event/list (renderer
  // khác, remount) không mang cờ engine nên cũng hiện copy mặc định.
  cliEngineLinked.value = state.attached ? state.linked : true
  if (state.attached) void learnCliTerminal()
  else cliTerminalId = null
}
// "Ngắt CLI" trên notice: kill PTY — lối thoát khỏi composer bị khoá không cần
// gõ `exit` trong shell. Engine dọn link + xếp import transcript trong onExit
// của PTY (rồi bắn `session.cli-synced`); subscription terminal.exit phía dưới
// xác nhận lại trạng thái, phòng một PTY mới được respawn xen giữa.
const cliDetaching = ref(false)
async function detachCli() {
  const eid = props.session.engineId
  if (!eid || !sc.available || cliDetaching.value) return
  cliDetaching.value = true
  try {
    // Học lại id từ registry thay vì tin cache — pane/renderer khác có thể đã
    // respawn một PTY mới dưới cùng khoá `cli:<eid>`.
    let target = cliTerminalId
    try {
      const res = await cliApi.list(`cli:${eid}`)
      target = res.terminals[0]?.terminalId ?? target
    } catch {
      // list lỗi — kill theo id đã biết nếu có.
    }
    if (target) await cliApi.kill(target)
  } catch (err) {
    // Kill thất bại → giữ nguyên khoá composer (PTY có thể còn sống).
    console.warn('[sessions] detach CLI failed', err)
    return
  } finally {
    cliDetaching.value = false
  }
  cliLinked.value = false
  cliEngineLinked.value = true
  cliTerminalId = null
  store.reloadTranscript(props.session.id)
}
// Đối chiếu registry sau một terminal.exit của nhóm `cli:<eid>`: còn PTY sống →
// giữ khoá + học id mới (respawn race — PTY CŨ vừa bị kill trong một nhịp đổi
// CLI cũng bắn exit); hết PTY → mở khoá composer + reload transcript (engine
// đã xếp import trong onExit; `session.cli-synced` đến sau sẽ refresh lần nữa).
async function reconcileCliLink(exitedId: string): Promise<void> {
  if (exitedId && exitedId === cliTerminalId) cliTerminalId = null
  const eid = props.session.engineId
  if (!eid) {
    cliLinked.value = false
    return
  }
  let alive: string | null = null
  try {
    const res = await cliApi.list(`cli:${eid}`)
    alive = res.terminals[0]?.terminalId ?? null
  } catch {
    // list lỗi — tin chính event exit: coi như không còn PTY nào. Nếu thực ra
    // còn (respawn race), chunk terminal.data kế tiếp sẽ khoá lại composer.
  }
  if (alive) {
    cliLinked.value = true
    cliTerminalId = alive
    return
  }
  cliLinked.value = false
  cliEngineLinked.value = true
  cliTerminalId = null
  store.reloadTranscript(props.session.id)
}
// Khôi phục `cliLinked` qua remount (KeepAlive / mở lại phiên): một PTY CLI còn
// sống được engine gom dưới `cli:<engineId>` trong registry terminal. Và lắng
// `session.cli-synced` + `terminal.*` — sync/exit/spawn có thể đến từ pane đang
// ẩn (v-show) HOẶC một renderer khác đang sở hữu phiên (popout), nên subscribe
// ở đây chứ không trông chờ emit `linked` của pane.
let unlistenCliSync: UnlistenFn | null = null
onMounted(async () => {
  const eid = props.session.engineId
  if (!sc.available) return
  if (eid) {
    try {
      const res = await cliApi.list(`cli:${eid}`)
      const t = res.terminals[0]
      if (t) {
        cliLinked.value = true
        cliTerminalId = t.terminalId
      }
    } catch {
      // terminal.list chưa có / engine cũ — cờ này chỉ là UI hint, bỏ qua.
    }
  }
  try {
    unlistenCliSync = await sc.onEvent((evt) => {
      // Đọc engineId SỐNG — phiên mount khi chưa persist rồi mới có engineId.
      const eidNow = props.session.engineId
      if (evt.type === 'session.cli-synced') {
        const p = evt.payload as { sessionId?: unknown }
        if (p?.sessionId === eidNow) store.reloadTranscript(props.session.id)
        return
      }
      if (!eidNow) return
      if (evt.type !== 'terminal.exit' && evt.type !== 'terminal.data') return
      const p = evt.payload as { terminalId?: unknown; sessionId?: unknown }
      // PTY của phiên này: group key `cli:<eid>` trong payload, hoặc đúng id
      // đang theo dõi (phòng payload thiếu sessionId).
      const ours =
        p?.sessionId === `cli:${eidNow}` ||
        (cliTerminalId !== null && p?.terminalId === cliTerminalId)
      if (!ours) return
      if (evt.type === 'terminal.data') {
        // Không có event "created": chunk đầu của một CLI mở ở renderer/popout
        // KHÁC là tín hiệu duy nhất — khoá composer ngay (engine đã chặn
        // sendMessage trên link đó).
        if (typeof p.terminalId === 'string') cliTerminalId = p.terminalId
        cliLinked.value = true
        return
      }
      // Exit — kể cả kill từ renderer khác. Đối chiếu registry trước khi mở
      // khoá: một nhịp respawn cũng khiến PTY CŨ bắn exit.
      void reconcileCliLink(typeof p.terminalId === 'string' ? p.terminalId : '')
    })
  } catch {
    // không có kênh event — nhịp sync tay vẫn tự reload qua syncCliTranscript.
  }
})
onBeforeUnmount(() => {
  unlistenCliSync?.()
  unlistenCliSync = null
  if (cliSyncedTimer) clearTimeout(cliSyncedTimer)
})

// ── Chế độ lưới (docs/features/session-runs.md) ────────────────────────────
// Không persist: lưới là cách NHÌN của lúc này, và mở lại một phiên vào thẳng lưới
// khi người dùng chỉ muốn đọc transcript thì hại hơn lợi. Ô nào hiện TRONG lưới thì
// có nhớ (SessionGrid tự lo).
const gridMode = ref(false)

// Yêu cầu "xem các phiên con dạng lưới" đến từ menu chuột phải của DANH SÁCH — cột
// sibling, không với tới `gridMode` ở đây (docs/features/session-runs.md §5). Mỗi
// lần nhận, tick tăng để lưới quên sở thích "ô nào hiện" của lần trước và bày lại đủ
// các phiên con: người dùng vừa yêu cầu đúng điều đó.
//
// `immediate` + gate `isActive`/`ownsThisSession` giống hệt đường pendingJump: danh
// sách đặt yêu cầu TRƯỚC khi instance này mount cho một phiên mở lần đầu, còn
// <KeepAlive> thì giữ instance của các phiên khác sống và vẫn phản ứng.
const gridRevealTick = ref(0)
function toggleGrid() {
  gridMode.value = !gridMode.value
  // Bật lưới trong khi pane CLI đang hiện: lưới thay chỗ nó (pane vẫn mount, PTY
  // sống — chỉ ẩn khỏi mắt). Hai chế độ thay chỗ cùng một bề mặt, không chồng nhau.
  if (gridMode.value) cliMode.value = false
  // Tắt lưới ⇒ quên yêu cầu "bày lại đủ các con". Không đưa về 0 thì lần bật sau từ
  // `⋯` vẫn mang tick cũ, và lưới lại xoá sở thích "ô nào hiện" của người dùng.
  if (!gridMode.value) gridRevealTick.value = 0
}
watch(
  [() => store.pendingGrid, isActive, ownsThisSession],
  () => {
    if (!isActive.value || !ownsThisSession.value) return
    if (!store.consumeGridRequest(props.session.id)) return
    gridMode.value = true
    gridRevealTick.value += 1
  },
  { immediate: true },
)

const ALL_VIEWS = [
  'Diff',
  'Files',
  'Terminal',
  'Browser',
  'Plan',
  'Tasks',
  'Team',
  'Preview',
  'Cost',
  'Info',
] as const
// Workspace panel starts EMPTY. The header's workspace button opens a view picker
// (dropdown, `menu === 'workspace'`); picking a view is what opens it (+ the panel),
// so clicking the button no longer dumps every default view at once.
const openViews = ref<string[]>([])
// Active view per dock side — kept valid by the watchers below.
const activeLeft = ref<string | null>(null)
const activeRight = ref<string | null>(null)
const activeBottom = ref<string | null>(null)

const leftTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'left'),
)
const rightTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'right'),
)
const bottomTabs = computed(() =>
  openViews.value.filter((v) => settings.workspaceDockOf(v) === 'bottom'),
)
const addableViews = computed(() => ALL_VIEWS.filter((v) => !openViews.value.includes(v)))

const wpLeftWidth = computed(() => settings.workspacePanel.leftWidth)
const wpWidth = computed(() => settings.workspacePanel.rightWidth)
const wpHeight = computed(() => settings.workspacePanel.bottomHeight)
const wpDragging = ref(false)

// Keep each side's active tab inside that side's tab set (falls back to the first
// tab, or null when the side is empty so its panel unmounts).
watch(
  leftTabs,
  (list) => {
    if (!activeLeft.value || !list.includes(activeLeft.value)) activeLeft.value = list[0] ?? null
  },
  { immediate: true },
)
watch(
  rightTabs,
  (list) => {
    if (!activeRight.value || !list.includes(activeRight.value)) activeRight.value = list[0] ?? null
  },
  { immediate: true },
)
watch(
  bottomTabs,
  (list) => {
    if (!activeBottom.value || !list.includes(activeBottom.value))
      activeBottom.value = list[0] ?? null
  },
  { immediate: true },
)
// Auto-close the panel once every view has been closed from all sides (closing the
// last tab, or toggling them all off in the picker).
watch([leftTabs, rightTabs, bottomTabs], ([l, r, b]) => {
  if (wpOpen.value && !l.length && !r.length && !b.length) wpOpen.value = false
})

// Add a view to a panel (the one whose "+" was clicked): pin its dock side, open
// it, and make it that side's active tab.
function addView(view: string, side: WorkspaceDockSide) {
  settings.setWorkspaceDock(view, side)
  if (!openViews.value.includes(view)) openViews.value.push(view)
  if (side === 'left') activeLeft.value = view
  else if (side === 'right') activeRight.value = view
  else activeBottom.value = view
}
function closeTab(view: string) {
  openViews.value = openViews.value.filter((v) => v !== view)
}
// Header view picker: open a view on its configured dock side (+ open the panel),
// or toggle it back off if already open. The auto-close watcher hides the panel
// once the last view is toggled off.
function openView(view: string) {
  wpOpen.value = true
  addView(view, settings.workspaceDockOf(view))
}
function toggleView(view: string) {
  if (openViews.value.includes(view)) closeTab(view)
  else openView(view)
  menu.value = null // close the picker on selection (single pick per open)
}
// Status-bar bridge: the footer's Files/Terminal buttons request a view toggle here;
// publish the open views back so those footer chips can reflect active state.
const wpBridge = useWorkspacePanel()
watch(
  () => wpBridge.requested.value,
  (req) => {
    if (req && isActive.value) toggleView(req.view)
  },
)
// Only the active instance owns the shared footer bridge: it publishes its open views
// (incl. when it becomes active), and the next active session overwrites them. Cached
// inactive instances never publish, so a switch can't race to an empty state.
watch(
  [openViews, isActive],
  ([v, active]) => {
    if (active) wpBridge.publishOpenViews(v)
  },
  { immediate: true },
)
// "View Browser đang thực sự hiển thị" — cờ cho auto-PiP (useBrowserPip). Khác
// openViews (chỉ liệt kê view MỞ): để che được trang thì view phải đang là tab
// active của dock nó, workspace panel phải đang mở (wpOpen=false = panel sập,
// view vẫn nằm trong openViews nhưng không render), VÀ session này đang được
// xem. Đổi route / đổi session (bị KeepAlive giấu) thì deactivate → cờ rơi →
// card được phép hiện lại.
const browserViewActive = computed(() => {
  if (!isActive.value || !wpOpen.value || !openViews.value.includes('Browser')) return false
  const side = settings.workspaceDockOf('Browser')
  const active =
    side === 'left' ? activeLeft.value : side === 'right' ? activeRight.value : activeBottom.value
  return active === 'Browser'
})
watch(browserViewActive, (v) => wpBridge.publishBrowserActive(v), { immediate: true })
onDeactivated(() => wpBridge.publishBrowserActive(false))
onActivated(() => wpBridge.publishBrowserActive(browserViewActive.value))
onBeforeUnmount(() => {
  if (isActive.value) {
    wpBridge.publishOpenViews([])
    wpBridge.publishBrowserActive(false)
  }
})
// Panel "×": close every view docked on that side.
function closeSide(side: WorkspaceDockSide) {
  const closing =
    side === 'left' ? leftTabs.value : side === 'right' ? rightTabs.value : bottomTabs.value
  openViews.value = openViews.value.filter((v) => !closing.includes(v))
}
// Move a view to a chosen side (reuses addView — the view is already open); it
// becomes that side's active tab.
function moveDock(view: string, side: WorkspaceDockSide) {
  addView(view, side)
}

// One handler for all three docks: drag X to resize a left/right column, Y for the
// bottom row. Each panel grows as the handle moves toward it — the left panel's
// handle sits on its right edge (drag right → grow, sign +1), the right/bottom
// panels' handles sit on their near edge (drag left/up → grow, sign −1).
const WP_SIDE = { min: 240, max: 560 } as const
const WP_BOTTOM = { min: 120, max: 600 } as const
function onWpResize(ev: PointerEvent, side: WorkspaceDockSide) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  wpDragging.value = true
  const vertical = side === 'bottom'
  const start = vertical ? ev.clientY : ev.clientX
  const startSize =
    side === 'left' ? wpLeftWidth.value : side === 'right' ? wpWidth.value : wpHeight.value
  const sign = side === 'left' ? 1 : -1
  const { min, max } = vertical ? WP_BOTTOM : WP_SIDE
  const onMove = (e: PointerEvent) => {
    const delta = (vertical ? e.clientY : e.clientX) - start
    const next = Math.max(min, Math.min(max, startSize + sign * delta))
    if (side === 'left') settings.setWorkspaceLeftWidth(next)
    else if (side === 'right') settings.setWorkspaceRightWidth(next)
    else settings.setWorkspaceBottomHeight(next)
  }
  const onUp = () => {
    wpDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
/* Anchor the drop overlay to the detail. */
.detail {
  position: relative;
}
/* Cột session là một HÀNG: dock trái/phải là anh em của cột chính nên chúng chạy
   hết chiều cao khung, còn header phiên chỉ trải trên cột chat. `.detail` gốc ở
   prototype.css là `flex-direction: column` và được DÙNG CHUNG với mọi trang
   detail khác (Skills/Agents/Tasks…), nên phải đổi qua class riêng `.sdrow` chứ
   không sửa `.detail`. */
.detail.sdrow {
  flex-direction: row;
}
/* Cột chính: header + chat + dock dưới. */
.sdmain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Detail header — shadcn idiom (spec §7): h-11, một hàng không wrap. `.dh` global
   là 50px/gap-10 cho mọi trang detail; ở đây siết về nhịp session: tiêu đề co
   (`.dttitle` đã truncate trong app-shell), mọi nút shrink-0.
   KHÔNG `overflow:hidden` ở đây (dù proto có): ba `.smenu` của header neo absolute
   trong `.dhanchor` và mở xuống QUA cạnh dưới thanh — clip ở `.dh` sẽ chặt đứt
   menu. Không-wrap đã đủ chặt nhờ flex-nowrap mặc định + `.dt{min-width:0}` +
   `.dttitle` ellipsis; khi panel hẹp chỉ title co.
   Giữ selector ở `.dh` trần: theme-cute (attr + class + element) phải thắng. */
.dh {
  height: 44px;
  gap: 6px;
}
.dh .dt {
  font-size: var(--fs-md);
  font-weight: 600;
  gap: 8px;
}
/* Status badge (proto `Badge`): không co khi title dài — meta co trước. */
.dhbadge {
  flex: 0 0 auto;
}
/* "agent · model" who-line (proto `text-xs text-muted-foreground` + icon 12px).
   Co + truncate trước title khi hẹp — proto `min-w-0 shrink truncate`; title
   `.dttitle` vẫn là phần tử đầu tiên nên thông tin không bao giờ mất hẳn. */
.dhwho {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 400;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
}
.dhwhotext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Anchor tương đối cho các menu `.smenu` neo dưới nút — flex item không được co
   (khi co, menu `absolute` tuỳ thuộc anchor vẫn đúng chỗ). */
.dhanchor {
  position: relative;
  flex: 0 0 auto;
}
/* Nút header = ghost iconSm của ui/Button (hover = accent-wash trung tính). Trạng
   thái "on" (panel đang mở / menu đang mở) = `bg-accent text-accent-foreground`
   đúng idiom toggle của proto. */
.dhb.on {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
/* Discuss banner (ADR 0055) — links a discussion session back to its task.
   Primary-tint callout: cùng ngôn ngữ "lit chip" của `.stab-btn.on`. */
.aboutbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px 8px;
  padding: 7px 11px;
  border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  color: var(--foreground);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}
.aboutbar:hover {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
}
.aboutbar-icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--primary);
}
.aboutbar-lbl {
  font-weight: 500;
  flex: 0 0 auto;
  color: var(--muted-foreground);
}
.aboutbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.aboutbar-chev {
  flex: 0 0 auto;
  opacity: 0.6;
}
/* SSH work banner (ADR 0064): the open-host button + per-session approval selector
   (governs the agent's mutating ssh_exec / ssh_write_file). */
.sshbar {
  margin: 0 14px 8px;
}
.sshbar-open {
  margin: 0 0 6px;
  width: 100%;
}
.sshbar-approval {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}
.sshbar-approval-lbl {
  font-weight: 500;
  color: var(--muted-foreground);
}
.sshbar-warn {
  margin: 6px 2px 0;
  color: var(--warning);
  line-height: var(--lh-sm);
}
/* Two-axis dock: .chatwrap stacks the top row (chat + right panel) over the
   full-width bottom panel; .wptop is the horizontal row the prototype's .chatwrap
   used to be. */
.chatwrap {
  flex-direction: column;
}
.wptop {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/* Positioned ancestor for the cute-only SessionDoneFlash chip (`position: absolute`
   inside it) — scoped, so it only affects `.chat` as rendered by this component. */
.chat {
  position: relative;
}
/* Notice "session is attached to a CLI" — muted bar, canh theo --padX như chính
   composer. Nút bên trong là ghost nhỏ: hover = accent-wash trung tính. */
.clinotice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 var(--padX) 8px;
  padding: 5px 10px;
  border-radius: var(--r-sm);
  background: var(--muted);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.clinoticetxt {
  flex: 1;
  min-width: 0;
}
.clinoticebtn {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: var(--r-xs);
  color: var(--muted-foreground);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.clinoticebtn:hover:not(:disabled) {
  background: var(--accent-wash);
  color: var(--foreground);
}
.clinoticebtn:disabled {
  cursor: default;
  opacity: 0.6;
}
/* Containing block for the find bar (absolute inside it): offsets it clear of the
   transcript's fold-all button at the same corner, without touching FindBar itself. */
.findwrap {
  position: absolute;
  top: 0;
  right: 38px;
  z-index: 6;
}
/* Resize handle docked at the bottom: a full-width row gripper (the prototype's
   .rszwp is a vertical col-resize bar for the right dock). The ::after divider
   runs horizontally instead of vertically. */
.rszwp.vert {
  flex: 0 0 6px;
  width: auto;
  align-self: stretch;
  cursor: row-resize;
}
.rszwp.vert::after {
  left: 0;
  right: 0;
  top: 2.5px;
  bottom: auto;
  width: auto;
  height: 1px;
}
.rszwp.vert:hover::after,
.rszwp.vert.drag::after {
  height: 2px;
  top: 2px;
  width: auto;
  left: 0;
}
/* Drop-anywhere overlay — dashed accent frame + centred hint. pointer-events:none
   so dragleave/drop fire on .detail itself (no flicker, the drop always lands). */
.dropzone {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: color-mix(in srgb, var(--background) 72%, transparent);
  border: 2px dashed var(--primary);
  border-radius: var(--radius);
}
.dropzone-inner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 18px;
  font-weight: 600;
  color: var(--primary);
  background: var(--popover);
  border: 1px solid var(--ring);
  border-radius: var(--radius);
}
/* Floating action bar next to a text selection (anchored to viewport coords). */
/* Floating selection action bar. Laid out at the viewport origin and moved ENTIRELY by
   `transform`, on purpose:
   `position: fixed` + `left: x` makes the available width `viewport - x`, and this bar is
   shrink-to-fit — so a selection near the right edge (every short, right-aligned USER
   bubble) squeezed the row until each button collapsed to min-content and its label broke
   mid-phrase ("Trích / dẫn"). Anchored at 0 the bar always measures against the full
   viewport.
   The percentages inside translate() resolve against the BAR's own box, so clamping
   there also keeps it fully on screen without measuring anything in JS:
     x → centred on the selection, but never closer than 8px to either edge
     y → above the selection, but never above the viewport top. */
.selactions {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 80;
  transform: translate(
    clamp(8px, calc(var(--sel-x, 0px) - 50%), calc(100vw - 100% - 8px)),
    max(8px, calc(var(--sel-y, 0px) - 100%))
  );
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100vw - 16px);
  /* Proto idiom: MỘT thanh popover (rounded-lg + border + bg-popover + shadow-lg,
     p-1) với các item ghost phẳng bên trong — không phải từng nút có khung riêng. */
  padding: 4px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}
.selquote {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  /* A two-word label is one label — never break it across lines. */
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--popover-foreground);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.selquote:hover {
  background: var(--accent-wash);
}
.selquote:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
/* Note popover (after clicking the floating Quote button). */
.notebackdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.notepop {
  position: fixed;
  z-index: 81;
  transform: translate(-50%, -100%);
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
/* Once dragged/resized, anchor by explicit top-left (drop the selection transform). */
.notepop.moved {
  transform: none;
}
.notepop.dragging {
  user-select: none;
}
.npq {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--primary);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: grab;
  touch-action: none;
}
.notepop.dragging .npq {
  cursor: grabbing;
}
.npq svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.npex {
  color: var(--muted-foreground);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 8em;
  overflow-y: auto;
}
/* Input theo idiom shadcn: border-input, nền trong suốt trên popover, focus =
   viền ring + halo ring 1px (không outline — giữ shape rounded). */
.npinput {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--input);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--foreground);
  outline: none;
  resize: vertical;
  min-height: 4.5em;
  line-height: var(--lh-sm);
  font-family: var(--sans);
}
/* When the popover has an explicit height (resized), grow the textarea to fill and
   let the popover own the sizing — its own resize handle replaces textarea resize. */
.notepop.moved .npinput {
  flex: 1 1 auto;
  resize: none;
}
.npinput:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 1px var(--ring);
}
.nprow {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.npbtn {
  padding: 4px 12px;
  border-radius: var(--r-xs);
  cursor: pointer;
  font-weight: 500;
  color: var(--muted-foreground);
}
.npbtn:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
.npbtn.pri {
  background: var(--primary);
  color: var(--primary-foreground);
}
.npbtn.pri:hover {
  background: color-mix(in srgb, var(--primary) 90%, transparent);
  color: var(--primary-foreground);
}
/* Bottom-right resize handle (single corner — AN-2 / OQ-B3). */
.npresize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(
    135deg,
    transparent 0 50%,
    var(--border) 50% 60%,
    transparent 60% 75%,
    var(--border) 75% 85%,
    transparent 85%
  );
}
</style>
