<template>
  <div class="composer" :class="{ cdis: disabled }">
    <div
      class="cresize"
      :class="{ drag: resizing }"
      :title="t('sessions.composer.resize')"
      @pointerdown="onResize"
    />
    <div class="cbox">
      <!-- follow-up quote cards (carried into the next turn) -->
      <div v-if="followups.length" class="sfollow" :class="{ scroll: followups.length > 3 }">
        <div v-for="(q, i) in followups" :key="i" class="fwcard">
          <div class="fwh">
            <span class="fwn">{{ CIRCLED[i] }}</span>
            <span
              class="fwq fwlink"
              :title="t('sessions.message.quote')"
              @click="void scrollToMessage(q.src)"
            >
              {{ q.excerpt }}
            </span>
            <span class="fwx" :title="t('sessions.quote.remove')" @click="removeQuote(i)">×</span>
          </div>
          <textarea
            class="fwnote"
            :value="q.note"
            rows="1"
            :placeholder="t('sessions.quote.notePlaceholder')"
            @input="onNote(i, $event)"
          />
        </div>
      </div>

      <!-- queued messages (gửi sau) — shown while the active turn is busy; a text
           message can be edited inline before it drains -->
      <div v-if="queued.length" class="attc qattc">
        <span
          v-for="(q, i) in queued"
          :key="i"
          class="att qatt"
          :class="{ editing: editingQueued === i }"
          :title="editingQueued === i ? '' : t('sessions.composer.queued')"
        >
          <Clock style="width: var(--icon-xs); height: var(--icon-xs)" />
          <textarea
            v-if="editingQueued === i"
            :ref="focusQueuedInput"
            v-model="queuedDraft"
            class="qedit"
            rows="1"
            @input="onQueuedInput"
            @keydown.enter.exact.prevent="saveQueuedEdit"
            @keydown.esc.prevent="cancelQueuedEdit"
            @blur="saveQueuedEdit"
            @click.stop
          />
          <template v-else>
            <span class="attn">{{ queuedLabel(q) }}</span>
            <span
              v-if="q.text && !q.command"
              class="qsend"
              :title="t('sessions.composer.queuedEdit')"
              @click.stop="startQueuedEdit(i)"
            >
              <PenLine style="width: var(--icon-xs); height: var(--icon-xs)" />
            </span>
            <span
              class="qsend"
              :title="t('sessions.composer.queuedSendNow')"
              @click.stop="sendQueuedNow(i)"
            >
              <SendHorizontal style="width: var(--icon-xs); height: var(--icon-xs)" />
            </span>
            <span class="x" :title="t('sessions.composer.queuedRemove')" @click.stop="dequeue(i)">
              ×
            </span>
          </template>
        </span>
      </div>

      <!-- slash `/` (commands + skills) + `@`-mention (agents/skills/wiki/files) -->
      <SessionSlashMenu
        v-if="autocomplete === 'slash'"
        :items="slashMatches"
        :active="acIndex"
        @select="applySlash"
        @hover="(i) => (acIndex = i)"
      />
      <SessionMentionMenu
        v-else-if="autocomplete === 'mention'"
        :items="mentionMatches"
        :active="acIndex"
        @select="applyMention"
        @hover="(i) => (acIndex = i)"
      />

      <!-- persistent while /compact runs; else transient built-in command feedback -->
      <div v-if="compacting" class="cmdnotice compacting">
        <Loader2 class="cmdspin" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('sessions.command.notice.compacting') }}
      </div>
      <div v-else-if="commandNotice" class="cmdnotice">{{ commandNotice }}</div>

      <!-- Pending attachments — INSIDE the card directly above the input (proto
           order: quotes → attachments → textarea). Chips preview via the shared
           modal, × removes, overflow collapses into "+N". -->
      <div v-if="attachments.length" class="attc pattc">
        <span
          v-for="(a, i) in visibleAtt"
          :key="i"
          class="att"
          :title="t('sessions.attachment.preview')"
          :style="{ cursor: 'pointer', paddingLeft: a.img ? '5px' : undefined }"
          @click="emit('preview', i)"
        >
          <img v-if="a.img && a.src" :src="a.src" class="attthumb" :alt="a.name" />
          <span v-else-if="a.img" class="thumb" />
          <Folder v-else-if="a.folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
          <FileText v-else style="width: var(--icon-xs); height: var(--icon-xs)" />
          <span class="attn">{{ a.name }}</span>
          <span
            class="x"
            :title="t('sessions.attachment.remove')"
            @click.stop="emit('remove-att', i)"
          >
            ×
          </span>
        </span>
        <span
          v-if="overflowCount"
          class="att attmore"
          :title="t('sessions.attachment.allTitle', { n: attachments.length })"
          @click="emit('open-more')"
        >
          {{ t('sessions.attachment.more', { n: overflowCount }) }}
        </span>
      </div>

      <!-- textarea is single-purpose composer input → resize handled by .cresize handle -->
      <textarea
        ref="ta"
        v-model="draft"
        class="ci"
        rows="1"
        :disabled="disabled"
        :placeholder="t('sessions.composer.placeholder')"
        @input="onInput"
        @keydown.down="onAcArrow($event, 1)"
        @keydown.up="onAcArrow($event, -1)"
        @keydown.esc="onEsc"
        @keydown.enter="onEnter"
        @paste="onPaste"
      />
      <!-- Pinned context (session working-set) is managed entirely from the pin button's
           popover below; the button shows a count so the bar stays uncluttered. -->

      <!-- soft budget warning: cumulative cost crossed the limit (no block). -->
      <div v-if="budgetOver" class="budgetwarn">
        <TriangleAlert style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
        {{ t('sessions.budget.warnBanner', { cost: budgetLabel }) }}
      </div>

      <div class="cbar">
        <!-- `+` menu (proto parity): label "Attach" → the native file/folder
             picker. The proto's per-type rows (Image / Video / Markdown) collapse
             into the ONE real attach action — the system dialog is type-agnostic
             and picks all of them. "Insert" types the autocomplete trigger for
             you: `/` opens the slash menu, `@` the mention menu — the menus stay
             single-source instead of a second picker drifting from them. -->
        <DropdownMenu @update:open="ddGuard">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="iconSm"
              class="cico"
              :title="t('sessions.composer.attach')"
              :aria-label="t('sessions.composer.attach')"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-56">
            <DropdownMenuLabel>{{ t('sessions.composer.attachTitle') }}</DropdownMenuLabel>
            <DropdownMenuItem @click="emit('pick')">
              <Paperclip />
              {{ t('sessions.composer.attach') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{{ t('sessions.composer.insert') }}</DropdownMenuLabel>
            <!-- Literal trigger glyphs — the same `/` and `@` the slash/mention
                 menus render, matching the proto's Slash/AtSign icons. -->
            <DropdownMenuItem @click="insertSlash">
              <span class="cmat">/</span>
              {{ t('sessions.composer.slashCommands') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="insertMention">
              <span class="cmat">@</span>
              {{ t('sessions.composer.mentionTitle') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span class="csep" />
        <!-- Model + reasoning-effort pickers (proto composer parity). The ghost-sm
             triggers open real menus fed by useSessionModelConfig — the SAME data
             source as the status-bar StatusConfig, so both surfaces list and write
             identical values (store actions underneath). Bound to THIS composer's
             session so a grid pane edits its own, not the active tab's. -->
        <DropdownMenu
          v-if="target"
          @update:open="
            (v: boolean) => {
              ddGuard(v)
              if (v) modelSection = 'model'
            }
          "
        >
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="cpick text-muted-foreground"
              :title="t('sessions.composer.modelTooltip')"
              :aria-label="t('statusbar.cfg.model')"
            >
              <Sparkles />
              <span class="cpicklbl">{{ selectedModel }}</span>
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-52">
            <!-- Model + account đi một cặp: account quyết định model nào khả dụng,
                 nên menu này có hai tab — cùng quy ước segment của StatusConfig.
                 Tab account chỉ đổi account của session, không phải của app. -->
            <div class="cseg">
              <button
                class="cseg-b"
                :class="{ on: modelSection === 'model' }"
                @click.stop="modelSection = 'model'"
              >
                {{ t('statusbar.cfg.model') }}
              </button>
              <button
                class="cseg-b"
                :class="{ on: modelSection === 'account' }"
                @click.stop="modelSection = 'account'"
              >
                {{ t('statusbar.cfg.account') }}
              </button>
            </div>
            <template v-if="modelSection === 'model'">
              <DropdownMenuItem v-for="m in availableModels" :key="m" @click="selectModel(m)">
                <span class="min-w-0 flex-1 truncate">{{ m }}</span>
                <Check v-if="m === selectedModel" class="ml-auto text-primary" />
              </DropdownMenuItem>
            </template>
            <template v-else>
              <DropdownMenuItem v-if="!accounts.length" disabled>
                <span class="min-w-0 flex-1 text-muted-foreground">
                  {{ t('sessions.config.noAccountHint') }}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem v-for="a in accounts" :key="a.id" @click="selectAccount(a)">
                <span class="min-w-0 flex-1 truncate">{{ a.display }}</span>
                <Check v-if="a.id === selectedAccountId" class="ml-auto text-primary" />
              </DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Effort hides on models that can't reason — the mirror of the status
             bar's hidden segment rule. -->
        <DropdownMenu v-if="target && thinkSupported" @update:open="ddGuard">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="cpick text-muted-foreground"
              :title="t('statusbar.effort.title')"
              :aria-label="t('statusbar.effort.title')"
            >
              <span class="cpicklbl">{{ thinkingLabel }}</span>
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-36">
            <DropdownMenuLabel>{{ t('statusbar.effort.title') }}</DropdownMenuLabel>
            <DropdownMenuItem v-for="[v, l] in THINK" :key="v" @click="selectThink(v)">
              <span class="min-w-0 flex-1 truncate">{{ l }}</span>
              <Check v-if="v === thinking && !ultracodeOn" class="ml-auto text-primary" />
            </DropdownMenuItem>
            <!-- Bậc thứ sáu, chỉ nhánh Claude SDK (ADR 0089) — cùng hàng và cùng
                 hint với picker ở status bar. -->
            <DropdownMenuItem
              v-if="ultracodeSupported"
              :title="t('common.thinking.ultracodeHint')"
              @click="selectUltracode"
            >
              <span class="min-w-0 flex-1 truncate">{{ t('common.thinking.ultracode') }}</span>
              <Check v-if="ultracodeOn" class="ml-auto text-primary" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Per-turn Mode chip (Ask/Plan/AcceptEdits/Execute) — a production extra
             the proto lacks; it stays on the row AFTER the two pickers. Model /
             account / effort / style still live on the status-bar chips too. -->
        <span
          class="chip sm chipbtn"
          :class="`mode-${selectedMode}`"
          :title="t('sessions.composer.modeTooltip')"
          style="position: relative"
          @click.stop="toggle('mode')"
        >
          <component :is="modeIcon" class="mico" />
          {{ t(`sessions.mode.${selectedMode}`) }}
          <ChevronDown class="mchev opacity-60" />
          <div
            v-if="open === 'mode'"
            class="smenu"
            style="position: absolute; bottom: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <div v-for="m in MODES_UI" :key="m.id" class="mi" @click="selectMode(m.id)">
              <component :is="m.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t(`sessions.mode.${m.id}`) }}
              <Check
                v-if="m.id === selectedMode"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </div>
          </div>
        </span>
        <!-- Overflow (session-ui-refactor §3.7): nguồn MCP · ghim context · làm đẹp
             prompt. Cả ba đều là cấu hình ĐẶT MỘT LẦN rồi để đó, không phải thao tác
             mỗi lượt như Mode hay đính kèm — nên chúng rời thanh, để composer còn
             đính kèm · Mode · ⋯ · Gửi. Chấm accent trên `⋯` giữ lại tín hiệu trạng
             thái đã mất khi chip biến đi. -->
        <span style="position: relative">
          <Button
            variant="ghost"
            size="iconSm"
            class="cmorebtn"
            :class="{ on: open === 'more' }"
            :title="t('sessions.composer.more')"
            @click.stop="toggle('more')"
          >
            <Ellipsis />
            <span v-if="hasPinned" class="fbadge">{{ pinnedCount }}</span>
          </Button>
          <div
            v-if="open === 'more'"
            class="pop cmorepop"
            style="position: absolute; bottom: 130%; right: 0; z-index: 50"
            @click.stop
          >
            <SessionMcpChip variant="inline" />
            <div class="cmoresep" />
            <button class="cmorerow" @click="onPinOpen">
              <Pin style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('sessions.pinned.title') }}
              <span v-if="pinnedCount > 0" class="cmorecount">{{ pinnedCount }}</span>
            </button>
            <button class="cmorerow" :disabled="enhancing" @click="onEnhance">
              <Sparkles
                class="enhicon"
                :class="{ enhspin: enhancing }"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              {{ enhancing ? t('sessions.composer.enhancing') : t('sessions.composer.enhance') }}
            </button>
          </div>
          <div
            v-if="open === 'pin'"
            class="pop pinpop"
            style="position: absolute; bottom: 130%; right: 0; z-index: 50"
            @click.stop
          >
            <div class="pinpop-h">{{ t('sessions.pinned.title') }}</div>
            <div class="pinpop-hint">{{ t('sessions.pinned.hint') }}</div>

            <!-- pinned files -->
            <div v-if="pinnedFiles.length" class="pinlist">
              <div v-for="f in pinnedFiles" :key="f" class="pinrow">
                <File style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
                <span class="pinpath" :title="f">{{ f }}</span>
                <span class="pinx" :title="t('sessions.pinned.remove')" @click="removePin(f)">
                  ×
                </span>
              </div>
            </div>

            <!-- applied reusable notes (toggled from the library below, like file pins) -->
            <div v-if="appliedNotes.length" class="pinlist">
              <div v-for="(n, i) in appliedNotes" :key="`an${i}`" class="pinrow" :title="n">
                <Pin style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
                <span class="pinpath">{{ noteLabel(n) }}</span>
                <span class="pinx" :title="t('sessions.pinned.remove')" @click="toggleNote(n)">
                  ×
                </span>
              </div>
            </div>

            <!-- add a file (workspace file index, same source as @-mention) -->
            <Input v-model="pinQuery" :placeholder="t('sessions.pinned.searchFiles')" />
            <div v-if="pinFileMatches.length" class="pinmatches">
              <div
                v-for="f in pinFileMatches"
                :key="f.path"
                class="pinmatch"
                :title="f.path"
                @click="addPin(f.path)"
              >
                <Plus style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
                <span class="pinmname">{{ f.name }}</span>
                <span class="pinmpath">{{ f.path }}</span>
              </div>
            </div>

            <!-- notes (persisted on blur) -->
            <textarea
              v-model="notesDraft"
              class="pinnotes"
              :placeholder="t('sessions.pinned.notesPlaceholder')"
              rows="3"
              @blur="saveNotes"
            />

            <!-- reusable notes: save the current note as a preset, or apply a saved
                 preset / recent note — a cross-session library (see useSessionNotePresets). -->
            <div class="pinreuse-bar">
              <button
                v-if="!presetNaming"
                class="pinreuse-save"
                :disabled="!notesDraft.trim()"
                :title="t('sessions.pinned.savePresetTitle')"
                @click="startPreset"
              >
                <Pin style="width: var(--icon-xs); height: var(--icon-xs)" />
                {{ t('sessions.pinned.savePreset') }}
              </button>
              <template v-else>
                <Input
                  ref="presetNameInput"
                  v-model="presetName"
                  :placeholder="t('sessions.pinned.presetNamePlaceholder')"
                  class="pinreuse-name"
                  @keydown.enter.prevent="confirmPreset"
                  @keydown.esc.prevent="cancelPreset"
                />
                <button
                  class="pinreuse-iconbtn"
                  :title="t('sessions.pinned.savePreset')"
                  @click="confirmPreset"
                >
                  <Check style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
                <button
                  class="pinreuse-iconbtn"
                  :title="t('sessions.pinned.cancelPreset')"
                  @click="cancelPreset"
                >
                  <X style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
              </template>
            </div>

            <template v-if="notePresets.length">
              <div class="pinreuse-h">{{ t('sessions.pinned.presets') }}</div>
              <div class="pinreuse-list">
                <div
                  v-for="p in notePresets"
                  :key="p.id"
                  class="pinreuse-item"
                  :class="{ active: isNoteApplied(p.text) }"
                  :title="p.text"
                  @click="toggleNote(p.text)"
                >
                  <Pin style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
                  <span class="pinreuse-label">{{ p.name }}</span>
                  <Check
                    v-if="isNoteApplied(p.text)"
                    :title="t('sessions.pinned.inUse')"
                    style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto"
                  />
                  <span
                    class="pinx"
                    :title="t('sessions.pinned.deletePreset')"
                    @click.stop="deleteNotePreset(p.id)"
                  >
                    ×
                  </span>
                </div>
              </div>
            </template>

            <template v-if="noteHistory.length">
              <div class="pinreuse-h">
                {{ t('sessions.pinned.recentNotes') }}
                <span class="pinreuse-clear" @click="clearNoteHistory">
                  {{ t('sessions.pinned.clearRecent') }}
                </span>
              </div>
              <div class="pinreuse-list">
                <div
                  v-for="(h, i) in noteHistory"
                  :key="i"
                  class="pinreuse-item"
                  :class="{ active: isNoteApplied(h) }"
                  :title="h"
                  @click="toggleNote(h)"
                >
                  <FileText style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto" />
                  <span class="pinreuse-label">{{ noteLabel(h) }}</span>
                  <Check
                    v-if="isNoteApplied(h)"
                    :title="t('sessions.pinned.inUse')"
                    style="width: var(--icon-xs); height: var(--icon-xs); flex: 0 0 auto"
                  />
                  <span
                    class="pinx"
                    :title="t('sessions.pinned.deleteRecent')"
                    @click.stop="deleteNoteHistory(h)"
                  >
                    ×
                  </span>
                </div>
              </div>
            </template>
          </div>
        </span>
        <span class="grow1" />
        <!-- Draft character counter — proto right-cluster readout (text-xs muted,
             tabular-nums so the digits don't jiggle the send button). -->
        <span class="ccount">{{ draft.length }}</span>
        <!-- Compacting → disabled processing button (Send locked until the RPC ends).
             Idle → Send. While a turn streams → Stop + a split steer/queue button
             (caret opens the alternate action). All icon-only per the proto
             iconSm idiom; labels live on the tooltips. -->
        <span v-if="compacting">
          <Button
            disabled
            :title="t('sessions.composer.compacting')"
            class="cicon"
            variant="default"
            size="iconSm"
          >
            <Loader2 class="cmdspin" />
          </Button>
        </span>
        <span v-else-if="!busy">
          <Button
            :disabled="!hasContent"
            :title="t('sessions.composer.send')"
            class="cicon"
            variant="default"
            size="iconSm"
            @click="send"
          >
            <SendHorizontal />
          </Button>
        </span>
        <span v-else class="sendgrp">
          <Button
            :title="t('sessions.composer.stopTooltip')"
            class="stop cicon"
            variant="default"
            size="iconSm"
            @click="sid != null && store.cancel(sid)"
          >
            <Square fill="currentColor" />
          </Button>
          <span v-if="hasContent" class="splitsend">
            <Button
              :title="streamPrimaryTitle"
              class="splitmain"
              variant="default"
              size="iconSm"
              @click="onStreamPrimary"
            >
              <component :is="streamPrimaryAction === 'steer' ? SendHorizontal : Clock" />
            </Button>
            <Button
              :title="t('sessions.composer.queue')"
              class="splitcaret"
              variant="default"
              size="iconSm"
              @click.stop="sendMenuOpen = !sendMenuOpen"
            >
              <ChevronUp />
            </Button>
            <div v-if="sendMenuOpen" class="smenu sendmenu" @click.stop>
              <div
                v-if="store.canSteerId(sid)"
                class="mi sty"
                :class="{ mdisabled: !canSteer }"
                @click="pickSteer"
              >
                <SendHorizontal class="styicon" />
                <div class="stytext">
                  <div class="nm2">{{ t('sessions.composer.steer') }}</div>
                  <div class="sd2">{{ t('sessions.composer.steerHint') }}</div>
                </div>
              </div>
              <div class="mi sty" @click="pickQueue">
                <Clock class="styicon" />
                <div class="stytext">
                  <div class="nm2">{{ t('sessions.composer.queue') }}</div>
                  <div class="sd2">{{ t('sessions.composer.queueHint') }}</div>
                </div>
              </div>
            </div>
          </span>
        </span>
      </div>
    </div>
    <div v-if="open" style="position: fixed; inset: 0; z-index: 40" @click="open = null" />
    <div
      v-if="sendMenuOpen"
      style="position: fixed; inset: 0; z-index: 40"
      @click="sendMenuOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// Composer — proto frame: one bordered card holding follow-up quote cards, queued
// chips, attachments, the textarea and a single footer row. Footer (proto order):
// `+` attach/insert menu · separator · model picker · effort picker · per-turn
// Mode chip · `⋯` overflow (MCP / pin / enhance) · char counter · icon-only send
// area. Textarea with Enter-to-send / Shift+Enter newline, enhance (one-shot
// rewrite via the store) and slash `/` + `@`-mention autocomplete (real engine
// sources via useComposerData: commands/skills/agents/files). When the active
// session is busy the Send action queues (gửi sau) instead of sending. Picker
// selections drive the STORE (read the target session, write via store actions)
// so they persist + take effect on the next turn; model/effort share
// useSessionModelConfig with the status-bar StatusConfig so the two surfaces
// never drift.
import type {
  QueuedMessage,
  Session,
  SessionAttachment,
  SlashCommandRef,
} from '~/composables/useSessionsData'
import { useComposerData } from '~/composables/useComposerData'
import { useWikiStore } from '~/stores/wiki'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import {
  BUILTIN_COMMANDS,
  findBuiltin,
  isOfferableCliCommand,
  MENTION_PAGE,
  type SlashItem,
  type MentionRow,
} from './session-composer-commands'
import { useBrowserContext, openBrowserTab } from '~/composables/useBrowserContext'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import {
  parseSlashInvocation,
  findInvocableCommand,
  expandCommandBody,
} from '~/utils/slash-command'
import {
  mentionTokenAt,
  removeMention,
  replaceMention,
  replaceSlashToken,
  slashHead,
  slashTokenAt,
  slashTokenEnd,
  type TextEdit,
} from '~/utils/composer-trigger'
// Toàn bộ icon composer dùng lucide trực tiếp (proto parity): nét stroke 2 của
// lucide sắc hơn glyph sprite `<Icon>` ở cỡ 14–16px mà footer/chip/menu cần.
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Ellipsis,
  File,
  FileText,
  Folder,
  ListChecks,
  Loader2,
  MessageSquare,
  Paperclip,
  PenLine,
  Pin,
  Play,
  Plus,
  SendHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    attachments?: SessionAttachment[]
    // Phiên mà composer này điều khiển. Bỏ trống = phiên đang mở (hành vi cũ, và là
    // đường mà SessionDetail dùng). Chế độ LƯỚI truyền id tường minh vì trên màn hình
    // có nhiều composer cùng lúc, mỗi cái cho một phiên khác nhau — nếu chúng đều đọc
    // `store.active` thì gõ vào ô nào cũng gửi cho đúng một phiên.
    sessionId?: number
    // Khoá cứng toàn composer — dùng khi phiên đang gắn vào một CLI ngoài
    // ("Open in CLI"): ô nhập + mọi đường send/queue/steer đều chết, chỉ còn
    // hiển thị mờ. Khác `busy`/`compacting` là chỗ này không hứa hẹn "gửi sau":
    // tin phải đi qua pane CLI. Cha tự lo dòng giải thích ngay phía trên.
    disabled?: boolean
  }>(),
  { attachments: () => [], sessionId: undefined, disabled: false },
)
const emit = defineEmits<{
  // `text` is the expanded body sent to the model; `command` (when set) is the
  // slash invocation displayed compactly in the user bubble.
  send: [text: string, command?: SlashCommandRef]
  pick: []
  'remove-att': [i: number]
  // A pasted clipboard image → a pending attachment for the parent to track
  // (mirrors the drag-drop / file-picker path). The parent owns `pendingAtt`.
  'add-att': [att: SessionAttachment]
  preview: [i: number]
  'open-more': []
}>()
const { t } = useI18n()
const settings = useSettingsStore()
const { CIRCLED } = useSessionsData()
const { scrollToMessage } = useSessionScroll()

// Cap inline chips; the rest collapse into a "+N more" chip that opens the list modal.
const MAX_INLINE = 6
const visibleAtt = computed(() => props.attachments.slice(0, MAX_INLINE))
const overflowCount = computed(() => Math.max(0, props.attachments.length - MAX_INLINE))

// Composer modes + their lucide icon (adds "Accept Edits" beyond the prototype's
// three — sprite names đổi sang component để footer đồng bộ nét lucide).
const MODES_UI = [
  { id: 'Ask', icon: MessageSquare },
  { id: 'Plan', icon: ListChecks },
  { id: 'AcceptEdits', icon: PenLine },
  { id: 'Execute', icon: Play },
] as const

const store = useSessionsStore()

// Phiên đích của composer NÀY. Mọi chỗ bên dưới đọc/ghi qua hai cái này thay vì
// `store.active` / `store.activeId` trực tiếp.
const sid = computed<number | null>(() => props.sessionId ?? store.activeId)
const target = computed(() =>
  props.sessionId != null
    ? (store.sessions.find((s) => s.id === props.sessionId) ?? null)
    : store.active,
)
const ta = useTemplateRef<HTMLTextAreaElement>('ta')

// Draft text is held PER SESSION in the store (not a local ref): SessionDetail is
// keyed by session id, so without this a half-typed message would die when the
// user switches sessions. Reads/writes go through the active session's `draft`.
const draft = computed<string>({
  get: () => target.value?.draft ?? '',
  set: (v) => {
    if (sid.value != null) store.setDraft(sid.value, v)
  },
})

// Real autocomplete sources — agents/files/user-commands/skills for the active
// session's project (lazy-loaded + cached, see useComposerData). Built-in slash
// commands (mode/compact/style) come from the static BUILTIN_COMMANDS catalog.
const projectIdRef = computed(() => target.value?.project ?? null)
// The Claude CLI's own commands (/goal, /context, /usage…) exist only on the Claude
// SDK branch, so the catalogue is fetched only there — and from the cwd the turn will
// run in (dragged folder wins over the project path, as in sessions.sendMessage).
const cliCommandsEnabled = computed(() => store.providerOfId(sid.value) === 'anthropic')
const cliWorkspacePath = computed(() => target.value?.workspaceFolder ?? null)
const data = useComposerData(projectIdRef, {
  enabled: cliCommandsEnabled,
  workspacePath: cliWorkspacePath,
})
const wiki = useWikiStore()
// Trình duyệt nhúng ↔ composer (ADR 0086): `@page` chèn trang đang mở thành khối
// context. Cùng composable mà chrome của tab Browser gọi cho "chọn element" và "trích
// đoạn bôi đen" — một nguồn sự thật cho khuôn khối context.
const browserCtx = useBrowserContext()
const agentHandle = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

// Transient command feedback line (e.g. "/compact running…", "Mode → Plan") shown
// above the textarea — built-in commands are actions with no chat bubble.
const commandNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(msg: string) {
  commandNotice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    commandNotice.value = null
  }, 4000)
}
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})

// Dispatch a built-in `/command` picked from the menu. Mode flips the session's
// permission mode; compact summarises older turns (real RPC, applies next turn);
// style opens the response-style popover. These are ACTIONS — never sent as text.
function onCommand(builtinId: string, arg = '') {
  const cmd = findBuiltin(builtinId)
  // `/browser` là hành động của app, không ghi gì vào session (khác mode/compact/style),
  // nên nó chạy TRƯỚC guard activeId — mở được cả khi chưa có session nào.
  if (cmd?.action.type === 'browser') {
    // Không showNotice ở đây: useBrowserContext tự toast (đã mở / lỗi / không có shell
    // desktop) — một nguồn phản hồi duy nhất cho mọi lối vào trình duyệt.
    void openBrowserTab(arg)
    return
  }
  if (!cmd || sid.value == null) return
  if (cmd.action.type === 'mode') {
    store.setMode(sid.value, cmd.action.mode)
    showNotice(t('sessions.command.notice.mode', { mode: t(`sessions.mode.${cmd.action.mode}`) }))
  } else if (cmd.action.type === 'compact') {
    // No transient notice here — store.compacting drives a persistent "compacting…"
    // line + a locked Send button for the whole RPC (result surfaces as a toast).
    void store.compactSession(sid.value).then((r) => {
      if (r === 'compacted') {
        useToast().add({ title: t('sessions.command.notice.compacted'), color: 'success' })
      } else if (r === 'nothing') {
        useToast().add({ title: t('sessions.command.notice.nothingToCompact'), color: 'info' })
      } else {
        useToast().add({ title: t('sessions.command.notice.compactFailed'), color: 'error' })
      }
    })
  } else if (cmd.action.type === 'style') {
    // The style picker moved to the status bar; `/style` pops it there.
    useStatusConfig().open('style')
  }
}

// Composer height. Two mechanisms used to fight each other: auto-grow forced the box
// up to a hard 640px ceiling (ignoring a smaller height the user just dragged to), and
// the JS ceilings (640/560) disagreed with the CSS `max-height: 40vh`. Now MANUAL
// resize wins over auto-grow (userSizedManually flag) and there is a SINGLE max source:
// 40vh, computed in px at runtime to keep JS clamp in sync with the CSS `40vh`.
// Floor matches the proto Textarea's `min-h-[52px]` (and the scoped `min-height`
// on .ci below) — one MIN source so the JS clamp and the CSS floor never disagree.
const COMPOSER_MIN_H = 52
// Runtime px equivalent of the CSS `textarea.ci { max-height: 40vh }` — one source of
// truth (DRY). Re-derived on window resize so the clamp tracks a shrinking viewport.
const composerMaxH = ref(Math.round(window.innerHeight * 0.4))
const composerH = ref(COMPOSER_MIN_H)
// True once the user has dragged the resize handle: auto-grow must NOT override the
// height they chose. Reset to false on send / clear draft / seed (back to auto-grow).
const userSizedManually = ref(false)
const resizing = ref(false)
function grow() {
  const el = ta.value
  if (!el) return
  if (userSizedManually.value) {
    // Manual override: hold the user's chosen height (clamped), scroll content inside.
    el.style.height = `${Math.min(Math.max(composerH.value, COMPOSER_MIN_H), composerMaxH.value)}px`
    return
  }
  // Auto-grow: fit content between MIN and MAX (40vh), then scroll internally.
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_H), composerMaxH.value)}px`
}
function onResize(e: PointerEvent) {
  e.preventDefault()
  resizing.value = true
  // Baseline from the textarea's ACTUAL rendered height, not `composerH`: in auto-grow
  // mode grow() sizes the box off scrollHeight without writing back to composerH, so it
  // stays stale at COMPOSER_MIN_H. Using it as the baseline would snap a tall (paste-max)
  // box down to min on the first move. offsetHeight matches how grow() sets el.style.height
  // (both border-box under box-sizing:border-box), so delta tracks the cursor 1:1. Seed
  // composerH with it BEFORE flipping to manual so the clamped hold picks up the real size.
  const el = ta.value
  const startH = el
    ? Math.min(Math.max(el.offsetHeight, COMPOSER_MIN_H), composerMaxH.value)
    : composerH.value
  composerH.value = startH
  userSizedManually.value = true
  const startY = e.clientY
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    // Drag up → taller. Clamp against the single MIN/MAX (40vh) source.
    composerH.value = Math.min(
      Math.max(COMPOSER_MIN_H, startH - (ev.clientY - startY)),
      composerMaxH.value,
    )
    grow()
  }
  const up = () => {
    resizing.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
// Window resize → re-derive the 40vh px ceiling and re-clamp so the input never pushes
// the toolbar / Execute·Stop off a shortened window.
function onWindowResize() {
  composerMaxH.value = Math.round(window.innerHeight * 0.4)
  composerH.value = Math.min(composerH.value, composerMaxH.value)
  grow()
}
onMounted(() => {
  grow()
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

// Quote / edit on a message seeds the composer draft (store.seedComposer reassigns a
// new object so this fires every time, even for identical text).
watch(
  () => store.draftSeed,
  (seed) => {
    // Chỉ NHẬN hạt giống dành cho phiên của composer này. `sid` null = "phiên đang mở",
    // nên ở chế độ lưới chỉ ô chính lấy. Không có chốt này thì một gợi ý bấm ở ô con đổ
    // chữ vào tất cả các ô.
    const target = seed.sid ?? store.activeId
    if (target !== sid.value) return
    draft.value = seed.text
    // Seeded draft returns to auto-grow so the whole seed (welcome starter / quote /
    // edit) is shown without being capped by a stale manual height (OQ 4.b).
    userSizedManually.value = false
    // Grow + focus so a seeded draft (welcome starter / quote / edit) lands ready
    // to type/send, cursor at the end.
    nextTick(() => {
      grow()
      const el = ta.value
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  },
)

// Follow-up quote cards for the active session (rendered above the input).
const followups = computed(() => target.value?.followups ?? [])
function removeQuote(i: number) {
  if (sid.value != null) store.removeQuote(sid.value, i)
}
function onNote(i: number, e: Event) {
  if (sid.value != null) store.setQuoteNote(sid.value, i, (e.target as HTMLTextAreaElement).value)
}

// The per-turn Mode chip reads straight off the active session (store-driven).
const selectedMode = computed(() => target.value?.mode || 'Ask')

// ── Model / reasoning-effort pickers (proto parity) ──────────────────────────
// The footer's ghost-sm triggers list + write through the same composable the
// status-bar StatusConfig uses, so the two surfaces can't drift. Bound to THIS
// composer's `target` — a grid-pane composer edits its own session. When nothing
// is bound (`target` null) the triggers don't render, so a stub keeps the getter
// total instead of a conditional composable call.
const EMPTY_SESSION: Session = {
  id: -1,
  title: '',
  project: '',
  model: '',
  account: '',
  style: '',
  status: 'idle',
  when: '',
  msgs: [],
}
const {
  selectedModel,
  availableModels,
  selectModel,
  accounts,
  selectedAccountId,
  selectAccount,
  thinking,
  thinkingLabel,
  thinkSupported,
  ultracodeSupported,
  ultracodeOn,
  selectUltracode,
  THINK,
  selectThink,
} = useSessionModelConfig(() => target.value ?? EMPTY_SESSION)

// Tab đang mở trong menu model (model | account) — reset về model mỗi lần mở
// menu để lần sau vào luôn thấy danh sách model, không phải tab đã rời đi.
const modelSection = ref<'model' | 'account'>('model')

// Composer popovers: Mode chip, overflow `⋯`, và popover ghim context mở TỪ trong
// overflow (cùng điểm neo, nên nó thay chỗ menu thay vì lồng vào trong).
type MenuKind = 'mode' | 'more' | 'pin'
const open = ref<MenuKind | null>(null)
function toggle(kind: MenuKind) {
  open.value = open.value === kind ? null : kind
}
// A reka DropdownMenu opening should retire any hand-rolled `.smenu`/`.pop` still
// up — two stacked menus read as a bug even though each dismisses on its own.
function ddGuard(v: boolean) {
  if (!v) return
  open.value = null
  sendMenuOpen.value = false
}

// ── Pinned context (session working-set) ─────────────────────────────────────
// Files + notes re-fed into every turn by the sidecar. Reads the active session;
// writes go through store actions (persist via upsert). The notes are edited via a
// local draft persisted on blur so we don't fire an upsert on every keystroke.
const pinnedFiles = computed<string[]>(() => target.value?.pinnedContext?.files ?? [])
// Reusable notes (preset / recent) applied to this session as toggled units — like
// attaching files. `appliedNotes` is the applied set; isNoteApplied flags which library
// items are on so they render active with a ✓. Multiple can be applied at once.
const appliedNotes = computed<string[]>(() => target.value?.pinnedContext?.notePresets ?? [])
const isNoteApplied = (text: string) => appliedNotes.value.includes(text.trim())
const hasPinned = computed(
  () =>
    pinnedFiles.value.length > 0 ||
    appliedNotes.value.length > 0 ||
    !!target.value?.pinnedContext?.notes?.trim(),
)
// Badge count on the pin button = files + applied notes + (1 if free-text notes set).
const pinnedCount = computed(
  () =>
    pinnedFiles.value.length +
    appliedNotes.value.length +
    (target.value?.pinnedContext?.notes?.trim() ? 1 : 0),
)
const notesDraft = ref('')
watch(
  () => [sid.value, target.value?.pinnedContext?.notes] as const,
  () => {
    notesDraft.value = target.value?.pinnedContext?.notes ?? ''
  },
  { immediate: true },
)
// Cross-session reusable notes: saved presets + recent history (localStorage-backed).
const {
  presets: notePresets,
  history: noteHistory,
  savePreset,
  deletePreset: deleteNotePreset,
  recordHistory,
  deleteHistory: deleteNoteHistory,
  clearHistory: clearNoteHistory,
  deriveName: noteLabel,
} = useSessionNotePresets()
function saveNotes() {
  if (sid.value != null) store.setPinnedNotes(sid.value, notesDraft.value)
  // Capture the committed note so it's reusable in other sessions (no-op when empty).
  recordHistory(notesDraft.value)
}
// Keep the current note as a named preset. Clicking "Save as preset" reveals an inline
// name field (prefilled with the first line) so the user can label it — Enter saves,
// Esc cancels. An empty name falls back to the derived label (savePreset handles it).
const presetNaming = ref(false)
const presetName = ref('')
const presetNameInput = useTemplateRef<HTMLInputElement>('presetNameInput')
function startPreset() {
  if (!notesDraft.value.trim()) return
  presetName.value =
    notesDraft.value
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  presetNaming.value = true
  void nextTick(() => presetNameInput.value?.focus())
}
function confirmPreset() {
  if (notesDraft.value.trim()) savePreset(notesDraft.value, presetName.value)
  presetNaming.value = false
  presetName.value = ''
}
function cancelPreset() {
  presetNaming.value = false
  presetName.value = ''
}
// Closing the pin popover abandons an in-progress naming so it doesn't reappear stale.
watch(
  () => open.value,
  (v) => {
    if (v !== 'pin') cancelPreset()
  },
)
// Toggle a reusable note (preset / recent) as an applied unit for this session — like
// attaching a file: click to apply, click again to remove (mirrored by the ✓ marker).
// Distinct from the free-text notes box; multiple can be applied at once.
function toggleNote(text: string) {
  if (sid.value != null) store.togglePinnedNotePreset(sid.value, text)
}
function removePin(path: string) {
  if (sid.value != null) store.removePinnedFile(sid.value, path)
}
// Wiki pages the model may actually read. `context: false` pages are excluded:
// offering one would insert a reference the agent is not allowed to resolve.
const wikiPagesInScope = computed(() => wiki.pages.filter((p) => p.context))

// File picker for pinning: reuse the workspace file index (same source as @-mention).
const pinQuery = ref('')
const pinFileMatches = computed(() => {
  const q = pinQuery.value.toLowerCase().trim()
  const pinnedSet = new Set(pinnedFiles.value)
  return data.files.value
    .filter((f) => !pinnedSet.has(f.path))
    .filter((f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    .slice(0, 12)
})
function addPin(path: string) {
  if (sid.value != null) store.addPinnedFile(sid.value, path)
  pinQuery.value = ''
}
function onPinOpen() {
  toggle('pin')
  if (open.value === 'pin') data.ensureFiles()
}

// ── Budget (cost cap) ─────────────────────────────────────────────────────────
// The cost/budget readout lives in the workspace panel's Cost tab; the composer
// only keeps the soft-limit OVER warning banner (a conditional safety alert).
const { fmtUsd, overSoft } = useSessionCost()
const budgetOver = computed(() => overSoft(target.value))
const budgetLabel = computed(() => {
  const cost = target.value?.usage?.cost
  const limit = target.value?.budget?.limitUsd
  return limit ? `${fmtUsd(cost ?? 0)} / ${fmtUsd(limit)}` : fmtUsd(cost)
})

// Mode chip selection → store action (persists + drives engineSettings next turn).
function selectMode(m: string) {
  if (sid.value != null) store.setMode(sid.value, m)
  open.value = null
}
const modeIcon = computed(
  () => MODES_UI.find((m) => m.id === selectedMode.value)?.icon ?? MessageSquare,
)

// ── Queue (gửi sau) ──────────────────────────────────────────────────────────
// While the active turn is busy, Send enqueues instead of sending; the queued
// messages render as chips above the input (the store auto-drains them FIFO when
// the turn settles — we only enqueue / display / remove).
const busy = computed(
  () => target.value?.status === 'streaming' || target.value?.status === 'awaiting',
)
// True while a `/compact` RPC is in flight — the composer shows a persistent
// "compacting…" notice + a disabled processing button and refuses to send/queue.
const compacting = computed(() => target.value?.compacting === true)
const queued = computed(() => target.value?.queue ?? [])
function dequeue(i: number) {
  if (sid.value != null) store.dequeue(sid.value, i)
}
// Jump the queue: stop the current turn and run this queued message right now.
function sendQueuedNow(i: number) {
  if (sid.value != null) void store.sendQueuedNow(sid.value, i)
}

// Inline-edit a queued text message before it drains. Only one chip edits at a time.
const editingQueued = ref<number | null>(null)
const queuedDraft = ref('')
// Stable function ref (called on mount/unmount, not on every keystroke): focus the
// editor, put the caret at the end, and size it to its content.
function focusQueuedInput(el: unknown): void {
  if (!(el instanceof HTMLTextAreaElement)) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
function onQueuedInput(e: Event): void {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
function startQueuedEdit(i: number) {
  const q = queued.value[i]
  if (!q || q.command) return
  queuedDraft.value = q.text
  editingQueued.value = i
}
// Commit the edit (Enter / blur). No-op on empty or unchanged; the × still removes.
function saveQueuedEdit() {
  const i = editingQueued.value
  if (i == null) return
  editingQueued.value = null
  const q = queued.value[i]
  const text = queuedDraft.value.trim()
  if (sid.value == null || !q || !text || text === q.text) return
  store.editQueued(sid.value, i, text)
}
function cancelQueuedEdit() {
  editingQueued.value = null
}
// A queued slash command previews as its compact invocation, not the expanded body.
// A quote-only queued message (empty draft) previews its note, else the quoted text.
function queuedLabel(q: QueuedMessage): string {
  if (q.command) return `/${q.command.name}${q.command.args ? ` ${q.command.args}` : ''}`
  if (q.text) return q.text
  const firstQuote = q.quotes?.[0]
  if (firstQuote) return firstQuote.note || firstQuote.excerpt
  return t('sessions.attachment.allTitle', { n: q.att?.length ?? 0 })
}

// Primary button state. Idle → Send. While a turn runs (busy): with something
// typed → Queue (gửi sau); with nothing typed → Stop (cancel the running turn).
const hasContent = computed(
  () => !!draft.value.trim() || props.attachments.length > 0 || followups.value.length > 0,
)
// Idle button shows Send. While a turn streams, the send area splits into a Stop
// button + a steer/queue split button (see template). `sendMenuOpen` toggles the
// caret dropdown that offers the alternate streaming action.
const sendMenuOpen = ref(false)

// A draft can be STEERED (injected into the running turn) only when it is text-only
// — attachments/quotes need a full turn, so those force Queue. Mirrors old UI.
const canSteerText = computed(
  () => !!draft.value.trim() && props.attachments.length === 0 && followups.value.length === 0,
)
// Steering also requires a runtime that consumes it: the Claude SDK path (anthropic)
// has no steering hook, so those sessions QUEUE instead (never silently drop the
// message). See store.canSteerId(sid.value).
const canSteer = computed(() => canSteerText.value && store.canSteerId(sid.value))
const streamPrimaryAction = computed<'steer' | 'queue'>(() => (canSteer.value ? 'steer' : 'queue'))
const streamPrimaryTitle = computed(() =>
  streamPrimaryAction.value === 'steer'
    ? t('sessions.composer.steerHint')
    : t('sessions.composer.queueHint'),
)

// Idle send → start a fresh turn. Slash command expands to its body (model gets the
// template) while `command` keeps the compact bubble label.
// Re-entry guard while the pre-send quota check awaits (the draft isn't cleared until
// after, so a fast double-Enter could otherwise fire two turns).
let sendChecking = false

async function sendNow() {
  // Khoá ngoài (CLI đang gắn) và khoá /compact — kiểm tra trước mọi cửa gửi.
  if (props.disabled || compacting.value) return
  const { text: outgoing, command } = buildOutgoing(draft.value)
  const hasAtt = props.attachments.length > 0
  const hasQuotes = followups.value.length > 0
  if (!outgoing.trim() && !hasAtt && !hasQuotes) return
  // Usage-quota gate: await a fresh read, then refuse the turn while KEEPING the draft
  // so the user doesn't lose what they typed. The store enforces the same gate too.
  if (sendChecking) return
  if (sid.value != null) {
    sendChecking = true
    try {
      if (await store.checkSendBlocked(sid.value)) {
        showNotice(t('sessions.quota.blockedSendNotice'))
        return
      }
    } finally {
      sendChecking = false
    }
  }
  closeAutocomplete()
  emit('send', outgoing, command)
  draft.value = ''
  userSizedManually.value = false
  nextTick(grow)
}

// Queue → stash the full draft (text + attachments) to auto-send as a fresh turn
// once the current one settles. We snapshot attachments into the store, then clear
// the parent's pendingAtt (descending so indices don't shift). NOT emitting `send`
// here is deliberate: the parent's onSend has no busy-guard and would open a second
// concurrent turn instead of queueing.
async function onQueue() {
  if (props.disabled) return
  const { text: outgoing, command } = buildOutgoing(draft.value)
  const hasAtt = props.attachments.length > 0
  const hasQuotes = followups.value.length > 0
  if (!outgoing.trim() && !hasAtt && !hasQuotes) return
  if (sid.value == null) return
  // Usage-quota gate: queueing only defers a turn that would be blocked on drain —
  // await a fresh read, refuse up front and keep the draft.
  if (sendChecking) return
  sendChecking = true
  try {
    if (await store.checkSendBlocked(sid.value)) {
      showNotice(t('sessions.quota.blockedSendNotice'))
      return
    }
  } finally {
    sendChecking = false
  }
  closeAutocomplete()
  store.enqueue(sid.value, outgoing, props.attachments, command)
  for (let i = props.attachments.length - 1; i >= 0; i--) emit('remove-att', i)
  draft.value = ''
  userSizedManually.value = false
  nextTick(grow)
}

// Steer → inject the raw draft text into the in-flight turn (text only; matches the
// old UI, which does not expand commands when steering). Clears just the draft.
async function onSteer() {
  if (props.disabled) return
  const text = draft.value
  if (!text.trim() || sid.value == null) return
  draft.value = ''
  userSizedManually.value = false
  closeAutocomplete()
  await store.steer(sid.value, text)
  showNotice(t('sessions.composer.steerDone'))
  nextTick(grow)
}

function onStreamPrimary() {
  if (streamPrimaryAction.value === 'steer') void onSteer()
  else void onQueue()
}
function pickSteer() {
  sendMenuOpen.value = false
  if (canSteer.value) void onSteer()
}
function pickQueue() {
  sendMenuOpen.value = false
  void onQueue()
}

// A draft that IS a built-in invocation (`/browser example.com`, or `/plan fix bug` via
// dispatchBareBuiltinDraft). Parsed here, not only in the menu: plain Enter with the
// autocomplete closed (Esc, args already typed, or a query that matched nothing) would
// otherwise SEND the line to the model, and built-ins are user actions — never prompts.
// Returns true when it dispatched.
function dispatchBuiltinDraft(): boolean {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(draft.value.trim())
  if (!m) return dispatchBareBuiltinDraft()
  const cmd = BUILTIN_COMMANDS.find((c) => c.name === m[1] && c.takesArg)
  if (!cmd) return dispatchBareBuiltinDraft()
  draft.value = ''
  userSizedManually.value = false
  closeAutocomplete()
  onCommand(cmd.id, (m[2] ?? '').trim())
  nextTick(grow)
  return true
}

// R-B7: built-in KHÔNG đối số gõ tay (`/plan fix bug`) khi menu đã đóng. Trước đây ca
// này luôn đi qua menu (menu mở với mọi draft bắt đầu `/`); nay menu chỉ mở khi con trỏ
// còn trong token đầu, nên thiếu nhánh này thì `/plan fix bug` thành prompt gửi model.
// Khớp CHÍNH XÁC tên (lowercase như query của menu cũ) — tiền tố `/pla` gửi như văn bản.
// Draft giữ phần sau token, đúng ngữ nghĩa nhánh built-in của applySlash.
// Trùng tên với user command / skill trong scope (`~/.claude/commands/plan.md`) ⇒ nhường
// cho thực thể của người dùng: menu liệt kê cả hai hàng, người dùng chọn hàng command
// thì Enter phải gửi command; built-in vẫn chạy được qua hàng của nó (dispatch theo id).
function dispatchBareBuiltinDraft(): boolean {
  const head = slashHead(draft.value)
  if (!head) return false
  const name = head.name.toLowerCase()
  const cmd = BUILTIN_COMMANDS.find((c) => !c.takesArg && c.name === name)
  if (!cmd || isUserSlashName(head.name)) return false
  draft.value = head.rest
  closeAutocomplete()
  onCommand(cmd.id, '')
  nextTick(grow)
  return true
}
function isUserSlashName(name: string): boolean {
  if (findInvocableCommand(data.userCommands.value, name, projectIdRef.value)) return true
  return data.skills.value.some((s) => s.id === name && inScope(s.source, s.projectId))
}

// Enter / primary action router: idle → fresh turn; streaming → steer or queue.
function send() {
  // Khoá ngoài (CLI đang gắn) + khoá /compact — không turn mới, không steer/queue.
  if (props.disabled || compacting.value) return
  // Hành động của người dùng, không phải tin nhắn: chạy kể cả khi session đang bận.
  if (dispatchBuiltinDraft()) return
  if (busy.value) {
    if (hasContent.value) onStreamPrimary()
    return
  }
  void sendNow()
}
function onEnter(e: KeyboardEvent) {
  // R-X4: Enter chốt chữ của IME thuộc về IME — không chọn mục, không gửi.
  if (isImeKey(e)) return
  // An open autocomplete steals plain Enter to accept the highlighted item (never
  // Shift+Enter — that chord is reserved for the send/newline logic below).
  if (autocomplete.value && !e.shiftKey) {
    e.preventDefault()
    acceptActive()
    return
  }
  // Which chord sends vs. inserts a newline follows the user's setting
  // (Settings → Defaults → composerSendKey):
  //   'enter'       → Enter sends, Shift+Enter = newline
  //   'shift-enter' → Shift+Enter sends, Enter = newline
  const sendOnShiftEnter = settings.appearance.composerSendKey === 'shift-enter'
  const isSendChord = sendOnShiftEnter ? e.shiftKey : !e.shiftKey
  if (!isSendChord) return // the other chord → let the textarea insert a newline
  e.preventDefault()
  send()
}

// ── Enhance ✨ (one-shot rewrite) ──────────────────────────────────────────────
const enhancing = ref(false)
async function onEnhance() {
  const text = draft.value.trim()
  if (!text || enhancing.value) return
  enhancing.value = true
  try {
    const enhanced = await store.enhancePrompt(text)
    if (enhanced) {
      draft.value = enhanced
      nextTick(grow)
    }
  } catch (err) {
    // Leave the draft unchanged on failure (network / model error).
    console.warn('[composer] enhance failed', err)
  } finally {
    enhancing.value = false
  }
}

// ── Autocomplete: slash `/` (commands + skills) + `@`-mention (agents + skills
// + wiki pages + files) ──
type Autocomplete = 'slash' | 'mention' | null
const autocomplete = ref<Autocomplete>(null)
const acIndex = ref(0)
// The caret-anchored query token (the word the user is typing) for `@`-mentions.
const mentionQuery = ref('')
// Rows per menu. Sized so a bare `@` (no query) still reaches the file rows after
// the entity rows above them — agents + skills alone are ~50 on a workspace that
// uses both tiers, and a cap that stops inside them would hide files completely.
const RESULT_CAP = 80
// The `/` menu has its own, much higher cap: with the Claude CLI catalogue merged in
// (~60 rows after dedupe) on top of AWOG's own built-ins + commands + skills, an
// empty `/` query is well past 80 entries, and a cap that cut into the CLI section
// would hide exactly the commands this list exists to expose. The dropdown scrolls.
const SLASH_RESULT_CAP = 240

// Từ khoá của token `/` (đoạn từ sau `/` tới con trỏ) — cùng vai trò với mentionQuery.
const slashQuery = ref('')

// Con trỏ THU GỌN, hoặc `null` khi có vùng chọn khác rỗng — khi đó coi như không có
// token tại con trỏ và menu đóng (E12). Toán học token nằm ở utils/composer-trigger.
function collapsedCaret(): number | null {
  const el = ta.value
  if (!el || el.selectionStart !== el.selectionEnd) return null
  return el.selectionStart
}
// Text mà con trỏ đang chỉ vào. Trong lúc soạn IME, v-model CHƯA ghi `draft` (Vue bỏ qua
// input khi `composing`) nhưng selectionStart đã tính trên value thật của textarea ⇒ đọc
// `draft` sẽ lệch vị trí (`Xem @` + caret 7 ⇒ chèn ra `Xem @@tiny.ts`). Ngoài IME hai
// nguồn trùng nhau.
function caretSource(): string {
  return ta.value?.value ?? draft.value
}

// In-scope check: global always; project entries only when bound to that project.
function inScope(source: 'global' | 'project' | undefined, projId: string | undefined): boolean {
  if ((source ?? 'global') === 'global') return true
  return !!projectIdRef.value && projId === projectIdRef.value
}

// `/` results: built-in commands (dispatched) + user commands + skills (inserted).
const slashMatches = computed<SlashItem[]>(() => {
  if (autocomplete.value !== 'slash') return []
  const q = slashQuery.value.toLowerCase()
  const builtins: SlashItem[] = BUILTIN_COMMANDS.filter(
    (c) => q === '' || c.name.startsWith(q),
  ).map((c) => ({
    key: `b:${c.id}`,
    label: c.name,
    desc: t(c.descKey),
    kind: 'builtin',
    builtinId: c.id,
  }))
  const cmds: SlashItem[] = data.userCommands.value
    .filter(
      (c) =>
        c.enabled !== false &&
        inScope(c.source, c.projectId) &&
        (q === '' || c.id.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)),
    )
    .map((c) => ({ key: `c:${c.id}`, label: c.id, desc: c.description, kind: 'command' }))
  const sk: SlashItem[] = data.skills.value
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (q === '' || s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)),
    )
    .map((s) => ({ key: `s:${s.id}`, label: s.id, desc: s.description, kind: 'skill' }))
  const cli: SlashItem[] = nativeCliCommands.value
    .filter(
      (c) =>
        q === '' ||
        c.name.toLowerCase().startsWith(q) ||
        (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(q)),
    )
    .map((c) => ({
      key: `x:${c.name}`,
      label: c.name,
      // The CLI leaves some descriptions blank; fall back to the argument hint so
      // the row still says something about how the command is called.
      desc: c.description || c.argumentHint,
      kind: 'cli',
    }))
  // CLI rows last: AWOG's own entries are what the user authored, and the CLI list
  // is long (~60 rows once the query is empty).
  return [...builtins, ...cmds, ...sk, ...cli].slice(0, SLASH_RESULT_CAP)
})

// Claude-CLI commands offered as NATIVE rows: everything the CLI advertises, minus
// its internal/AWOG-owned entries (isOfferableCliCommand) and minus every name AWOG
// already serves itself. The overlap is real — the CLI advertises the same skills we
// scan from `.claude/skills`, and a skill must keep AWOG's behaviour (the id goes to
// the model with our own catalogue) rather than silently switching to CLI expansion.
const nativeCliCommands = computed(() => {
  if (!cliCommandsEnabled.value) return []
  const ours = new Set<string>(BUILTIN_COMMANDS.map((c) => c.name))
  for (const c of data.userCommands.value) {
    if (c.enabled !== false && inScope(c.source, c.projectId)) ours.add(c.id)
  }
  for (const sk of data.skills.value) {
    if (inScope(sk.source, sk.projectId)) ours.add(sk.id)
  }
  return data.cliCommands.value.filter((c) => isOfferableCliCommand(c.name) && !ours.has(c.name))
})

// Name → CLI command, including aliases (/cost and /stats both resolve to /usage),
// so a typed alias is recognised as native too.
const nativeCliByName = computed(() => {
  const map = new Map<string, string>()
  for (const c of nativeCliCommands.value) {
    map.set(c.name, c.name)
    for (const a of c.aliases ?? []) map.set(a, c.name)
  }
  return map
})

// `@` results, in pick order: agents (by handle), skills (by id), wiki pages, then
// workspace files (filename matches ranked above path-only matches). Entities come
// first because they are a short, named set the user asked for by name; files are
// the long tail. Capped — the list scrolls + user narrows.
const mentionMatches = computed<MentionRow[]>(() => {
  if (autocomplete.value !== 'mention') return []
  const q = mentionQuery.value.toLowerCase()
  // The trigger regex keeps `:` inside the token, so a user narrowing an already
  // inserted `@skill:…` / `@wiki:…` types a query that still carries the prefix.
  // Match the id / page path against the part AFTER it — otherwise re-typing over
  // one of those tokens empties the menu.
  const unprefixed = (prefix: string) => (q.startsWith(prefix) ? q.slice(prefix.length) : q)
  const qSkill = unprefixed('skill:')
  const qWiki = unprefixed('wiki:')
  // `@page` — hàng HÀNH ĐỘNG, đứng đầu như built-in ở menu `/`: một mục ngắn người dùng
  // gọi đúng tên, còn agent/skill/wiki/file là phần đuôi dài. Luôn hiện, kể cả trong
  // browser-dev: chọn nó lúc không có trình duyệt thì attachPage() toast một câu chứ
  // không chèn khối rỗng (cùng đường xử lý với "chưa mở trang nào").
  const pageRows: MentionRow[] = MENTION_PAGE.startsWith(q)
    ? [
        {
          key: 'page',
          kind: 'page',
          insert: MENTION_PAGE,
          label: t('sessions.composer.mentionPageLabel'),
          hint: t('sessions.composer.mentionPageHint'),
        },
      ]
    : []
  const agents: MentionRow[] = data.agents.value
    .filter(
      (a) => q === '' || agentHandle(a.name).startsWith(q) || a.name.toLowerCase().includes(q),
    )
    .map((a) => ({
      key: `a:${a.id}`,
      kind: 'agent',
      insert: agentHandle(a.name),
      label: a.name,
      hint: a.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  // Skills, both tiers (~/.claude/skills + {project}/.claude/skills — ADR 0070).
  // Same catalogue the `/` menu offers and the same one the turn advertises as
  // <available_skills>; `@skill:<id>` points the model at one without expanding a
  // whole command body into the draft. Tier filter mirrors slashMatches.
  const skills: MentionRow[] = data.skills.value
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (qSkill === '' ||
          s.id.toLowerCase().startsWith(qSkill) ||
          s.name.toLowerCase().includes(qSkill)),
    )
    .map((s) => ({
      key: `s:${s.source}:${s.id}`,
      kind: 'skill',
      insert: `skill:${s.id}`,
      label: s.id,
      hint: s.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  // Wiki pages in THIS session's scope (ADR 0073). Ranked above files: a wiki page
  // is an explicit, small reference the model can act on with wiki_read, whereas a
  // file match is often incidental. Pages hidden from agents (`context: false`) are
  // excluded — offering one would insert a reference the model cannot resolve.
  const wikiRows: MentionRow[] = wikiPagesInScope.value
    .filter(
      (w) =>
        qWiki === '' ||
        w.title.toLowerCase().includes(qWiki) ||
        w.path.toLowerCase().includes(qWiki),
    )
    .map((w) => ({
      key: `w:${w.source}:${w.path}`,
      kind: 'wiki',
      insert: `wiki:${w.path}`,
      label: w.title,
      hint: w.path,
    }))
  const matched = data.files.value.filter(
    (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
  )
  const ranked = q
    ? [...matched].sort((a, b) => {
        const an = a.name.toLowerCase().includes(q) ? 0 : 1
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1
        return an - bn || a.path.localeCompare(b.path)
      })
    : matched
  const files: MentionRow[] = ranked.map((f) => ({
    key: `f:${f.path}`,
    kind: 'file',
    insert: f.path,
    label: f.name,
    hint: f.path,
  }))
  return [...pageRows, ...agents, ...skills, ...wikiRows, ...files].slice(0, RESULT_CAP)
})

// R-X1…R-X3: đánh giá menu theo token TẠI CON TRỎ, không theo cả draft.
// - 'input' (gõ/xoá/dán): được MỞ menu; onInput đã đưa highlight về mục đầu.
// - 'caret' (selectionchange — click, mũi tên, kéo chọn…): chỉ chạy khi menu ĐANG mở,
//   tức đóng hoặc lọc lại chứ không bao giờ mở (người dùng chỉ đi ngang một mention cũ
//   thì không muốn menu bật lên giành phím Enter). Menu đóng ⇒ thoát ngay, nên gõ trong
//   draft dài không tốn gì thêm. Query không đổi ⇒ giữ highlight (R-X3).
// Token `/` không chứa khoảng trắng nên không thể đồng thời là token `@`: không có token
// lệnh thì rơi xuống menu `@` (R-B8 — mention dùng được trong draft có lệnh).
function refreshAutocomplete(cause: 'input' | 'caret') {
  if (cause === 'caret' && !autocomplete.value) return
  const prevKind = autocomplete.value
  const prevQuery = prevKind === 'slash' ? slashQuery.value : mentionQuery.value
  const caret = collapsedCaret()
  const v = caretSource()
  let kind: Autocomplete = null
  let query = ''
  if (caret != null) {
    const slashQ = slashTokenAt(v, caret)
    const mention = slashQ == null ? mentionTokenAt(v, caret) : null
    if (slashQ != null) {
      kind = 'slash'
      query = slashQ
    } else if (mention) {
      kind = 'mention'
      query = mention.query
    }
  }
  if (!kind) {
    autocomplete.value = null
    return
  }
  if (kind === 'slash') {
    data.ensureCatalogs() // lazy-load user commands + skills on first `/`
    slashQuery.value = query
  } else {
    data.ensureCatalogs() // agents + skills
    data.ensureFiles() // workspace file index
    if (!wiki.loaded) void wiki.loadTree() // wiki pages (ADR 0073)
    mentionQuery.value = query
  }
  if (cause === 'caret' && (kind !== prevKind || query !== prevQuery)) acIndex.value = 0
  autocomplete.value = kind
  const len = kind === 'slash' ? slashMatches.value.length : mentionMatches.value.length
  if (acIndex.value >= len) acIndex.value = 0
  if (!len) autocomplete.value = null
}
function closeAutocomplete() {
  autocomplete.value = null
  acIndex.value = 0
}

function onInput() {
  grow()
  acIndex.value = 0
  refreshAutocomplete('input')
}

// Di chuyển con trỏ không qua input: một nguồn `selectionchange` phủ mọi kiểu (click,
// kéo chọn kể cả thả chuột ngoài textarea, ←/→/Home/End/⌘/⌥, Shift+mũi tên, ⌘A,
// setSelectionRange bằng code) thay vì giữ danh sách phím. Chốt `activeElement` để chỉ
// composer đang focus xử lý (lưới / KeepAlive có nhiều instance). Không lặp với
// onAcArrow: ↑/↓ lúc menu mở đã preventDefault nên con trỏ không đổi, không có event.
function onSelectionChange() {
  if (document.activeElement === ta.value) refreshAutocomplete('caret')
}
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

// R-X4: phím đang thuộc về IME (chốt chữ, chọn ứng viên, huỷ soạn) — composer bỏ qua,
// KHÔNG preventDefault. Electron là Chromium: keydown trong lúc soạn (kể cả Enter chốt
// chữ) có isComposing. Gom một chỗ để nếu máy thật lọt thì chỉ thêm `keyCode === 229`.
function isImeKey(e: KeyboardEvent): boolean {
  return e.isComposing
}
function onEsc(e: KeyboardEvent) {
  if (isImeKey(e)) return
  closeAutocomplete()
}

// Arrow keys cycle the highlighted item while a menu is open (else fall through to
// default textarea caret movement).
function onAcArrow(e: KeyboardEvent, dir: 1 | -1) {
  if (isImeKey(e) || !autocomplete.value) return
  const len =
    autocomplete.value === 'slash' ? slashMatches.value.length : mentionMatches.value.length
  if (!len) return
  e.preventDefault()
  acIndex.value = (acIndex.value + dir + len) % len
}
function acceptActive() {
  if (autocomplete.value === 'slash') applySlash(acIndex.value)
  else if (autocomplete.value === 'mention') applyMention(acIndex.value)
}

// Gán draft đã biên tập rồi đặt con trỏ tại `edit.caret` (R-B4/R-D3/R-D5). Phải chờ
// nextTick: draft ghi qua store, Vue patch `el.value` ở lượt render và việc gán value bằng
// code đẩy con trỏ về cuối. grow() trước setSelectionRange vì `height: auto` có thể reset
// scrollTop; đặt con trỏ sau cùng để Chromium cuộn nó vào tầm nhìn. Menu đóng trước nên
// selectionchange do setSelectionRange sinh ra là no-op.
function applyDraftEdit(edit: TextEdit) {
  draft.value = edit.text
  closeAutocomplete()
  nextTick(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    grow()
    el.setSelectionRange(edit.caret, edit.caret)
  })
}

function applySlash(i: number) {
  const item = slashMatches.value[i]
  if (!item) return
  if (item.kind === 'builtin' && item.builtinId) {
    // Built-ins are actions: strip the typed token and dispatch (no text insert).
    // Built-in có đối số (`/browser <url>`) ăn luôn phần còn lại: đó là tham số, không
    // phải text người dùng còn muốn giữ trong ô soạn.
    const src = caretSource()
    const rest = slashHead(src)?.rest ?? src
    const takesArg = findBuiltin(item.builtinId)?.takesArg === true
    draft.value = takesArg ? '' : rest
    closeAutocomplete()
    onCommand(item.builtinId, takesArg ? rest.trim() : '')
    nextTick(() => {
      ta.value?.focus()
      grow()
    })
    return
  }
  // User command / skill / CLI → `/id ` thay token đầu, con trỏ ngay sau khoảng trắng
  // chèn kèm (không nhảy về cuối) ⇒ menu đóng và gõ tiếp là args (expand lúc gửi).
  applyDraftEdit(replaceSlashToken(caretSource(), item.label))
}
function applyMention(i: number) {
  const item = mentionMatches.value[i]
  if (!item) return
  // Token tính lại TẠI LÚC CHỌN từ con trỏ hiện tại — không regex neo cuối draft, nên
  // mention ở đầu/giữa câu thay đúng chỗ và các `@…` khác không bị đụng (R-D2).
  const src = caretSource()
  const caret = collapsedCaret()
  const token = caret == null ? null : mentionTokenAt(src, caret)
  if (!token) {
    closeAutocomplete()
    return
  }
  if (item.kind === 'page') {
    // Hành động, không phải token: gỡ `@…` đang gõ rồi để useBrowserContext chèn khối
    // context của trang — cùng một nguồn với nút trong chrome của tab Browser. Gỡ TRƯỚC
    // vì insertBlock đọc draft trong store (setter của draft ghi đồng bộ) — R-D5.
    applyDraftEdit(removeMention(src, token))
    void browserCtx.attachPage()
    return
  }
  applyDraftEdit(replaceMention(src, token, item.insert))
}

// ── `+` menu → Insert (proto parity) ──────────────────────────────────────────
// The autocomplete menus trigger off the character itself, so an Insert item just
// types the trigger and lets the normal input path open the matching menu — no
// parallel picker to keep in sync. Focus moves on a macrotask so it wins over the
// dropdown's own focus-restore-to-trigger on close. `caret` mặc định là cuối draft.
function refocusDraft(caret?: number) {
  setTimeout(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    const pos = caret ?? el.value.length
    el.setSelectionRange(pos, pos)
    onInput()
  }, 0)
}
function insertSlash() {
  // The slash menu keys on the first token after `/`: an empty draft gets a bare
  // `/`; a typed draft gets `/` prepended so its first word becomes the live
  // filter (picking a command then replaces that token, keeping the rest). Con trỏ
  // đặt ở cuối token đầu (R-B6) — ở cuối draft thì đã qua khoảng trắng, menu không mở.
  const next = draft.value.startsWith('/') ? draft.value : `/${draft.value}`
  draft.value = next
  refocusDraft(slashTokenEnd(next))
}
function insertMention() {
  // The mention regex needs `@` at the caret preceded by start-of-line or space.
  draft.value += /(^|\s)$/.test(draft.value) ? '@' : ' @'
  refocusDraft()
}

// Expand a `/command args` draft into the user command's body on send (built-ins
// are dispatched — via the menu or dispatchBuiltinDraft — never sent as text). Returns the expanded `text`
// for the model plus the `command` invocation for the compact bubble; a
// non-invocation (or unknown command) passes the raw text through with no command.
function buildOutgoing(raw: string): { text: string; command?: SlashCommandRef } {
  const inv = parseSlashInvocation(raw)
  if (!inv) return { text: raw }
  const cmd = findInvocableCommand(data.userCommands.value, inv.name, projectIdRef.value)
  if (cmd) {
    return {
      text: expandCommandBody(cmd.body, inv.args),
      command: { name: inv.name, args: inv.args },
    }
  }
  // A Claude-CLI command: rebuilt from the parsed parts rather than passed through
  // as the raw draft, because the CLI recognises a local command only when the
  // message STARTS with `/` — a stray leading newline would make it prose.
  const native = nativeCliByName.value.get(inv.name)
  if (native) {
    return {
      text: inv.args ? `/${inv.name} ${inv.args}` : `/${inv.name}`,
      command: { name: inv.name, args: inv.args, native: true },
    }
  }
  return { text: raw }
}

// Byte length of a string (chip size meta) — mirrors the dropped/picked file path.
const byteLen = (s: string): number => new TextEncoder().encode(s).length

// ── Clipboard paste → attachment ──────────────────────────────────────────────
// Two cases beyond plain text (small pastes fall through to the textarea insert):
//   1) clipboard images (screenshots, copied image files) → inline image
//      attachment (data URL, re-fed each turn — see memory image-attachments).
//   2) a large plain-text paste (≥ threshold, when "paste as file" is enabled) →
//      a `pasted-text-N.txt` attachment instead of dumping it inline, keeping the
//      input clean. Capped to ATTACHMENT_TEXT_MAX like dropped/picked text files.
function onPaste(e: ClipboardEvent) {
  const data = e.clipboardData
  if (!data) return

  // (1) Images on the clipboard.
  let handledImage = false
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    handledImage = true
    e.preventDefault() // keep the data URL out of the textarea text
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) return
      const ext = file.type.split('/')[1] || 'png'
      const att: SessionAttachment = {
        name: file.name || `pasted-${Date.now()}.${ext}`,
        img: true,
        dataUrl,
        src: dataUrl,
        mime: file.type,
        size: file.size,
      }
      emit('add-att', att)
    }
    reader.readAsDataURL(file)
  }
  if (handledImage) return

  // (2) Large plain-text paste → a .txt attachment (gated by the user setting).
  if (!settings.sessions.pasteAsFile) return
  const text = data.getData('text/plain')
  if (!text || text.length < settings.sessions.pasteThreshold) return
  e.preventDefault()
  const value = text.slice(0, ATTACHMENT_TEXT_MAX)
  const truncated = value.length < text.length
  const index = props.attachments.filter((a) => a.name.startsWith('pasted-text-')).length + 1
  const att: SessionAttachment = {
    name: `pasted-text-${index}.txt`,
    img: false,
    text: value,
    mime: 'text/plain',
    size: byteLen(value),
  }
  emit('add-att', att)
  if (truncated) showNotice(t('sessions.composer.pasteTruncated'))
}
</script>

<style scoped>
/* Composer strip — proto frame: the card floats on the session background with
   breathing room around it (px-4 pb-3 → horizontal keeps the shared --padX
   column gutter, 12px bottom). No separator strip / panel fill of its own. */
.composer {
  border-top: 0;
  background: transparent;
  padding: 0 var(--padX) 8px;
}
/* Chrome cốt lõi của composer (card .cbox, textarea .ci, chip .att/.pattc,
   thanh .cbar, .csep/.cmat/.ccount, .cmdnotice…) đã hoist lên `prototype.css`
   để WorkspaceBoardComposer (ô giao việc trên board) xài chung nguyên xi —
   hai bản scoped sẽ trôi khỏi nhau. Phần scoped còn lại dưới đây chỉ giữ
   chrome riêng của session (model/mode picker, queue, follow-up, split-send). */
/* iconSm trigger glyph ⋯ — Button's own `[&_svg]:size-3.5` ép 14px; nâng lên
   --icon-md cho ngang cụm send/picker (16px, lucide `size-4`). `.cico` (+) có
   rule ở prototype.css rồi. */
.cbar .cmorebtn svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
/* "Send now" on a queued chip: mirror the remove badge but on the opposite (top-left)
   corner with an accent (positive) hover — reveal on chip hover so it doesn't crowd
   the queued-message label. Only rendered inside `.qatt` chips. */
.att .qsend {
  position: absolute;
  top: -7px;
  left: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--popover);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.att:hover .qsend,
.att:focus-within .qsend {
  opacity: 1;
  transform: scale(1);
}
.att .qsend:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
/* Toolbar pickers — ghost buttons, not outlined chips (proto: h-7 ghost,
   text-xs muted-foreground + chevron). Border phải `!important`: global
   `.mode-Plan`/`.mode-Execute` (`prototype.css`) cũng dùng `!important` để tô
   viền tint — chừa nó thì chip Mode lệch khỏi hàng ghost. Tint giữ trên TEXT
   (Execute emerald / Plan amber) làm tín hiệu "lượt này chạy khác"; viền bỏ. */
.cbar .chip.chipbtn {
  height: 28px;
  padding: 0 8px;
  border-color: transparent !important;
  background: transparent;
  box-shadow: none;
  border-radius: var(--r-sm);
  color: var(--muted-foreground);
}
.cbar .chip.chipbtn:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
/* Mode chip: icon mode + chevron ở --icon-sm — lucide svg render 24px mặc định
   nên phải ép size (sprite <Icon> tự ép trong component). */
.cbar .chipbtn .mico,
.cbar .chipbtn .mchev {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}
/* Tab chuyển mục trong menu model (Model | Account) — cùng quy ước `.cfgseg` của
   StatusConfig: accent-tint cho mục đang chọn, không fill xám đặc. */
.cseg {
  display: flex;
  gap: 3px;
  padding: 2px 2px 6px;
  box-shadow: inset 0 -1px 0 var(--border);
  margin-bottom: 4px;
}
.cseg-b {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted-foreground);
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.cseg-b:hover {
  color: var(--foreground);
  background: var(--accent-wash);
}
.cseg-b.on {
  color: var(--primary);
  border-color: var(--ring);
  background: var(--accentDim);
}
/* ⋯ overflow trigger — ui <Button variant="ghost" size="iconSm">; `.cmorebtn`
   anchors the pinned-count badge (.fbadge) and carries the lit "menu open" tint. */
.cmorebtn {
  position: relative;
  color: var(--muted-foreground);
}
.cmorebtn.on {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
}
/* Tactile press: primary action buttons dip slightly when pressed, and the
   primary's hover brightness now eases in instead of snapping. */
.btn {
  transition:
    transform 0.08s ease,
    filter 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.btn:active {
  transform: scale(0.95);
}
@media (prefers-reduced-motion: reduce) {
  .cbox,
  .btn {
    transition: none;
  }
  .btn:active {
    transform: none;
  }
}
/* follow-up quote container (cards use prototype .fwcard/.fwh/.fwn/.fwq/.fwx/.fwnote) */
.sfollow {
  display: flex;
  flex-direction: column;
  gap: 7px;
  /* Card top section — owns its inset like the proto quote row (`px-2.5 pt-2.5`). */
  margin-bottom: 0;
  padding: 8px 10px 0;
}
/* Quote card — proto idiom: rounded-lg border + translucent muted fill. The
   circled ① (.fwn) carries the accent, so the card itself stays neutral (the
   prototype's accent left-border is dropped). */
.fwcard {
  background: color-mix(in srgb, var(--muted) 40%, transparent);
  border-color: var(--border);
  border-left-width: 1px;
  border-radius: var(--radius);
}
/* Cap the visible quote stack at ~3 cards; beyond that the box scrolls so a long
   stack of follow-up quotes can't push the textarea + toolbar off-screen. The
   partial 4th card peeks to hint there's more. padding-right keeps the scrollbar
   off the card borders. */
.sfollow.scroll {
  max-height: 210px;
  overflow-y: auto;
  padding-right: 4px;
}
/* Clickable follow-up excerpt → jump to the quoted message (§8). */
.fwlink {
  cursor: pointer;
}
.fwlink:hover {
  color: var(--primary);
  text-decoration: underline;
}
/* Queued (gửi sau) chip row sits above the input; chips reuse .att with a primary
   tint so they read as pending-send rather than attachments. */
.qattc {
  /* Card top section — same `px-2.5 pt-2.5` inset as the other chip rows. */
  margin-bottom: 0;
  padding: 8px 10px 0;
}
.qatt {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
/* While editing a queued message, the chip reads as active + gives the editor room. */
.qatt.editing {
  border-color: var(--primary);
}
/* Inline editor for a queued message — blends into the chip, grows with its content. */
.qedit {
  flex: 1 1 auto;
  min-width: 160px;
  max-width: 340px;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  overflow: hidden;
  color: var(--primary);
  font: inherit;
  line-height: var(--lh-sm);
}
/* Enhance spinner while the one-shot rewrite is in flight (local rotation — the
   prototype `.spin` is a pulsing dot scoped under .steph, not a rotator). */
.enhicon {
  transition: opacity 0.15s ease;
}
.enhicon.enhspin {
  animation: enhspin 0.9s linear infinite;
}
@keyframes enhspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enhicon.enhspin {
    animation: none;
  }
}
/* Locked Send while /compact runs — reads as processing (dimmed, not clickable).
   Primary action cluster uses Button size="iconSm" (28px) — the old .btn.pri.sm
   height pin died in the shadcn migration. */
.cbar .cicon:disabled {
  cursor: default;
  opacity: 0.5;
  filter: none;
}
/* Stop state: the primary button turns destructive-tinted while a turn is running
   and nothing is queued (click cancels the turn). */
.cbar .stop {
  background: var(--destructive);
}
.cbar .stop:hover {
  background: color-mix(in srgb, var(--destructive) 88%, black);
}

/* Streaming send area: Stop + a split steer/queue button (caret opens the
   alternate action in a small upward menu). */
.sendgrp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.splitsend {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}
.splitmain {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.splitcaret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding-left: 6px;
  padding-right: 6px;
  border-left: 1px solid color-mix(in srgb, var(--primary-foreground) 25%, transparent);
}
/* Anchor the menu above the split button (the base .smenu is position:fixed). */
.sendmenu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 224px;
}
/* Popover chrome on the composer's hand-rolled menus (mode picker + send split
   menu): the global .smenu/.pop keep their class hooks, the look moves to the
   shadcn tokens — popover surface, hairline border, radius var(--radius), items
   rounded-sm with the neutral accent-wash hover. */
.smenu {
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 4px;
}
.smenu .mi {
  padding: 6px 8px;
  border-radius: var(--r-xs);
  color: var(--muted-foreground);
}
.smenu .mi:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.smenu .mi .ck {
  color: var(--primary);
}
/* Steer/queue rows: stacked name + hint (the .stylemenu .mi.sty idiom — the split
   menu isn't under .stylemenu, so the layout lives here). */
.sendmenu .mi.sty {
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
}
.sendmenu .styicon {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: none;
  margin-top: 1px;
  color: var(--muted-foreground);
}
.sendmenu .mi.sty:hover .styicon {
  color: var(--accent-foreground);
}
.sendmenu .stytext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sendmenu .nm2 {
  color: var(--foreground);
}
.sendmenu .sd2 {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
  white-space: normal;
}

/* Soft-budget warning banner above the toolbar (no block — just a heads-up). */
.budgetwarn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 10px 2px;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 18px;
  color: var(--destructive);
  background: color-mix(in srgb, var(--destructive) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--destructive) 40%, transparent);
}

/* Pinned-context popover (toolbar pin button). Reuses the .pop chrome; adds a file
   list + add-file search + a notes textarea. */
.pinpop {
  width: 320px;
  max-width: 80vw;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Popover chrome — same shadcn pass as .smenu above (popover surface, hairline
   border, --radius, mid shadow). */
.pop {
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.pinpop-h {
  font-weight: 600;
  color: var(--foreground);
}
.pinpop-hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--muted-foreground);
  margin-top: -4px;
}
.pinlist {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pinrow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--r-xs);
  background: var(--muted);
  color: var(--foreground);
}
.pinrow .icn {
  color: var(--muted-foreground);
}
.pinpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* mono-ok: pinned file path */
  font-family: var(--code);
  font-size: 12px;
  line-height: 18px;
}
.pinx {
  cursor: pointer;
  color: var(--muted-foreground);
  padding: 0 2px;
  border-radius: var(--r-xs);
}
.pinx:hover {
  color: var(--destructive);
}
.pininput,
.pinnotes {
  width: 100%;
  background: transparent;
  border: 1px solid var(--input);
  border-radius: var(--r-xs);
  padding: 6px 8px;
  color: var(--foreground);
  font-size: 12px;
  line-height: 18px;
}
.pininput:focus,
.pinnotes:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--ring);
}
.pinnotes {
  resize: vertical;
  min-height: 3.5rem;
  font-family: inherit;
}
.pinmatches {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow: auto;
}
.pinmatch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--foreground);
}
.pinmatch .icn {
  color: var(--muted-foreground);
}
.pinmatch:hover {
  background: var(--accent-wash);
}
.pinmname {
  font-size: 12px;
  line-height: 18px;
  flex: 0 0 auto;
}
.pinmpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--muted-foreground);
  /* mono-ok: pinned file path */
  font-family: var(--code);
}
/* Reusable-notes section (save as preset + presets/recent lists). */
.pinreuse-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: -2px;
}
.pinreuse-name {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid var(--input);
  border-radius: var(--r-xs);
  padding: 5px 8px;
  color: var(--foreground);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}
.pinreuse-name:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--ring);
}
.pinreuse-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.pinreuse-iconbtn:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
.pinreuse-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--input);
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.pinreuse-save:hover:not(:disabled) {
  background: var(--accent-wash);
}
.pinreuse-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.pinreuse-h {
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--muted-foreground);
}
.pinreuse-clear {
  margin-left: auto;
  font-weight: 500;
  cursor: pointer;
  color: var(--muted-foreground);
}
.pinreuse-clear:hover {
  color: var(--destructive);
}
.pinreuse-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 150px;
  overflow: auto;
}
.pinreuse-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--foreground);
}
.pinreuse-item .icn {
  color: var(--muted-foreground);
}
.pinreuse-item:hover {
  background: var(--accent-wash);
}
/* The library item matching the note currently in the box — the one actually in use.
   Inset ring (not a border) so the primary marker adds no layout shift. */
.pinreuse-item.active {
  color: var(--primary);
  background: var(--accent-wash);
  box-shadow: inset 0 0 0 1px var(--ring);
}
.pinreuse-item.active .icn {
  color: var(--primary);
}
.pinreuse-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}

/* ── Overflow `⋯` của composer (session-ui-refactor §3.7) ──────────────────
   Một popover chứa: danh sách nguồn MCP (inline, không lồng popover) · hàng mở
   popover ghim context · hàng làm đẹp prompt. Dùng lại `.pop` cho khung, chỉ
   thêm phần hàng bấm được. */
.cmorepop {
  min-width: 244px;
}
.cmoresep {
  height: 1px;
  margin: 7px 0;
  background: var(--border);
}
.cmorerow {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  background: transparent;
  border-radius: var(--r-xs);
  color: var(--foreground);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  text-align: left;
}
.cmorerow:hover:not(:disabled) {
  background: var(--accent-wash);
}
.cmorerow:disabled {
  opacity: 0.55;
  cursor: default;
}
.cmorerow .icn {
  color: var(--muted-foreground);
  flex: 0 0 auto;
}
.cmorecount {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--primary);
}
</style>
