<template>
  <!-- Dải composer — khung proto: card nổi trên nền phiên, thở quanh nó (ngang giữ
       gutter --padX dùng chung của cột, đáy 8px). Không có dải phân cách / nền panel. -->
  <div class="shrink-0 bg-transparent px-(--padX) pb-2">
    <!-- Tay nắm kéo đổi chiều cao composer (vạch mảnh, sáng accent khi hover/kéo). -->
    <div
      class="mx-auto -mt-0.5 mb-px flex h-2.25 cursor-ns-resize items-center justify-center after:h-0.75 after:w-8.5 after:rounded-full after:content-['']"
      :class="resizing ? 'after:bg-primary' : 'after:bg-border hover:after:bg-primary'"
      :title="t('sessions.composer.resize')"
      @pointerdown="onResize"
    />
    <!-- Card: viền input, bo xl, shadow nhẹ; focus-within thêm vòng ring 1px. -->
    <div
      class="mx-auto w-full max-w-215 rounded-xl border border-input bg-background p-0 shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:ring-1 focus-within:ring-ring motion-reduce:transition-none"
      :class="disabled && 'pointer-events-none opacity-55'"
    >
      <!-- follow-up quote cards (carried into the next turn). Tối đa ~3 thẻ hiện; dài
           hơn thì khung cuộn (thẻ thứ 4 ló ra báo còn nữa), để chồng trích dẫn không
           đẩy textarea + toolbar ra khỏi màn hình. -->
      <div
        v-if="followups.length"
        class="flex flex-col gap-2 pt-2 pl-2.5"
        :class="followups.length > 3 ? 'max-h-52.5 overflow-y-auto pr-1' : 'pr-2.5'"
      >
        <!-- Thẻ trích dẫn: viền + nền muted mờ; số khoanh ① mang màu accent nên thẻ trung tính. -->
        <div v-for="(q, i) in followups" :key="i" class="rounded-lg border bg-muted/40 px-2.5 py-2">
          <div class="flex items-center gap-2 text-sm">
            <span class="shrink-0 text-primary">{{ CIRCLED[i] }}</span>
            <!-- Đoạn trích bấm được → nhảy tới message được trích (§8). -->
            <span
              class="flex-1 cursor-pointer truncate text-muted-foreground hover:text-primary hover:underline"
              :title="t('sessions.message.quote')"
              @click="void scrollToMessage(q.src)"
            >
              {{ q.excerpt }}
            </span>
            <span
              class="cursor-pointer text-lg leading-4 text-dim hover:text-destructive"
              :title="t('sessions.quote.remove')"
              @click="removeQuote(i)"
            >
              ×
            </span>
          </div>
          <textarea
            class="mt-1.5 min-h-[1.5em] w-full resize-y border-none bg-transparent font-sans text-sm text-foreground outline-none placeholder:text-faint"
            :value="q.note"
            rows="1"
            :placeholder="t('sessions.quote.notePlaceholder')"
            @input="onNote(i, $event)"
          />
        </div>
      </div>

      <!-- queued messages (gửi sau) — shown while the active turn is busy; a text
           message can be edited inline before it drains. Chip tô primary để đọc ra là
           "chờ gửi" chứ không phải đính kèm. -->
      <div v-if="queued.length" class="flex flex-wrap gap-1.5 px-2.5 pt-2">
        <span
          v-for="(q, i) in queued"
          :key="i"
          :class="[
            ATT_BASE,
            'bg-primary/12 px-2 text-primary hover:border-input hover:bg-accent',
            editingQueued === i ? 'border-primary' : 'border-primary/42',
          ]"
          :title="editingQueued === i ? '' : t('sessions.composer.queued')"
        >
          <Clock class="size-3" />
          <!-- Ô sửa tin chờ — hoà vào chip, lớn theo nội dung. -->
          <textarea
            v-if="editingQueued === i"
            :ref="focusQueuedInput"
            v-model="queuedDraft"
            class="m-0 max-w-85 min-w-40 flex-auto resize-none overflow-hidden border-none bg-transparent p-0 leading-(--lh-sm) text-primary outline-none [font:inherit]"
            rows="1"
            @input="onQueuedInput"
            @keydown.enter.exact.prevent="saveQueuedEdit"
            @keydown.esc.prevent="cancelQueuedEdit"
            @blur="saveQueuedEdit"
            @click.stop
          />
          <template v-else>
            <span class="max-w-42 truncate">{{ queuedLabel(q) }}</span>
            <!-- Sửa / gửi ngay: badge nổi góc TRÁI-trên, hover tích cực (primary); hiện khi
                 hover chip để không chen nhãn. -->
            <span
              v-if="q.text && !q.command"
              :class="QSEND_CLASS"
              :title="t('sessions.composer.queuedEdit')"
              @click.stop="startQueuedEdit(i)"
            >
              <PenLine class="size-3" />
            </span>
            <span
              :class="QSEND_CLASS"
              :title="t('sessions.composer.queuedSendNow')"
              @click.stop="sendQueuedNow(i)"
            >
              <SendHorizontal class="size-3" />
            </span>
            <span
              :class="ATT_X_CLASS"
              :title="t('sessions.composer.queuedRemove')"
              @click.stop="dequeue(i)"
            >
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
      <div
        v-if="compacting"
        class="mx-2.5 mt-2 inline-flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1 text-sm text-muted-foreground"
      >
        <Loader2 class="size-3 animate-spin motion-reduce:animate-none" />
        {{ t('sessions.command.notice.compacting') }}
      </div>
      <div
        v-else-if="commandNotice"
        class="mx-2.5 mt-2 rounded-md border bg-muted px-2.5 py-1 text-sm text-muted-foreground"
      >
        {{ commandNotice }}
      </div>

      <!-- Pending attachments — INSIDE the card directly above the input (proto
           order: quotes → attachments → textarea). Chips preview via the shared
           modal, × removes, overflow collapses into "+N". -->
      <div v-if="attachments.length" class="flex flex-wrap gap-1.5 px-2.5 pt-2">
        <span
          v-for="(a, i) in visibleAtt"
          :key="i"
          :class="[ATT_BASE, ATT_IDLE, a.img ? 'pr-2 pl-1.25' : 'px-2']"
          :title="t('sessions.attachment.preview')"
          @click="emit('preview', i)"
        >
          <img
            v-if="a.img && a.src"
            :src="a.src"
            class="size-4.5 shrink-0 rounded-sm object-cover"
            :alt="a.name"
          />
          <span
            v-else-if="a.img"
            class="size-4 shrink-0 rounded-sm bg-linear-135 from-info to-lavender"
          />
          <Folder v-else-if="a.folder" class="size-3" />
          <FileText v-else class="size-3" />
          <span class="max-w-42 truncate">{{ a.name }}</span>
          <span
            :class="ATT_X_CLASS"
            :title="t('sessions.attachment.remove')"
            @click.stop="emit('remove-att', i)"
          >
            ×
          </span>
        </span>
        <span
          v-if="overflowCount"
          :class="[
            ATT_BASE,
            'cursor-pointer border-dashed bg-transparent px-2 font-medium text-muted-foreground hover:border-input hover:text-foreground',
          ]"
          :title="t('sessions.attachment.allTitle', { n: attachments.length })"
          @click="emit('open-more')"
        >
          {{ t('sessions.attachment.more', { n: overflowCount }) }}
        </span>
      </div>

      <!-- textarea is single-purpose composer input → resize handled by the drag handle
           above (resize-none). Giữ `<textarea>` thô: script đọc caret/scrollHeight trực
           tiếp qua ref `ta`. min-h-13 (52px) = COMPOSER_MIN_H; max-h 40vh = composerMaxH. -->
      <textarea
        ref="ta"
        v-model="draft"
        class="block max-h-[40vh] min-h-13 w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-2 font-sans text-base text-foreground outline-none placeholder:text-muted-foreground"
        :class="disabled && 'cursor-not-allowed'"
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
      <div
        v-if="budgetOver"
        class="mx-2.5 mt-1.5 mb-0.5 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/12 px-2 py-1 text-sm text-destructive"
      >
        <TriangleAlert class="size-3 shrink-0" />
        {{ t('sessions.budget.warnBanner', { cost: budgetLabel }) }}
      </div>

      <!-- Thanh công cụ: một hàng duy nhất — nhãn co được, nút giữ cỡ tự nhiên. -->
      <div class="flex flex-nowrap items-center gap-1 px-2 pb-2">
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
              class="shrink-0 [&_svg]:size-4"
              :title="t('sessions.composer.attach')"
              :aria-label="t('sessions.composer.attach')"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            class="w-56 max-h-[min(420px,60vh)] overflow-y-auto"
          >
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
              <span class="w-4 shrink-0 text-center text-muted-foreground">/</span>
              {{ t('sessions.composer.slashCommands') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="insertMention">
              <span class="w-4 shrink-0 text-center text-muted-foreground">@</span>
              {{ t('sessions.composer.mentionTitle') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" class="mx-1 h-4 shrink-0" />
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
              class="min-w-0 shrink px-2 text-sm font-normal text-muted-foreground [&_svg]:size-4"
              :title="t('sessions.composer.modelTooltip')"
              :aria-label="t('statusbar.cfg.model')"
            >
              <Sparkles />
              <span class="max-w-35 truncate">{{ selectedModel }}</span>
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            class="w-52 max-h-[min(420px,60vh)] overflow-y-auto"
          >
            <!-- Model + account đi một cặp: account quyết định model nào khả dụng,
                 nên menu này có hai tab — cùng quy ước segment của StatusConfig
                 (accent-tint cho mục đang chọn, không fill xám đặc).
                 Tab account chỉ đổi account của session, không phải của app. -->
            <div
              class="mb-1 flex gap-0.5 px-0.5 pt-0.5 pb-1.5 shadow-[inset_0_-1px_0_var(--border)]"
            >
              <Button
                variant="ghost"
                size="xs"
                :class="[SEG_CLASS, modelSection === 'model' && SEG_ON_CLASS]"
                @click.stop="modelSection = 'model'"
              >
                {{ t('statusbar.cfg.model') }}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                :class="[SEG_CLASS, modelSection === 'account' && SEG_ON_CLASS]"
                @click.stop="modelSection = 'account'"
              >
                {{ t('statusbar.cfg.account') }}
              </Button>
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
              class="min-w-0 shrink px-2 text-sm font-normal text-muted-foreground [&_svg]:size-4"
              :title="t('statusbar.effort.title')"
              :aria-label="t('statusbar.effort.title')"
            >
              <span class="max-w-35 truncate">{{ thinkingLabel }}</span>
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            class="w-36 max-h-[min(420px,60vh)] overflow-y-auto"
          >
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
             account / effort / style still live on the status-bar chips too.
             Nút ghost (không viền); tint giữ trên CHỮ (Execute = accent, Plan = hổ
             phách) làm tín hiệu "lượt này chạy khác". -->
        <span class="relative shrink-0">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-sm [&_svg]:size-3.5"
            :class="
              selectedMode === 'Plan'
                ? 'text-warning hover:text-warning'
                : selectedMode === 'Execute'
                  ? 'text-primary hover:text-primary'
                  : 'text-muted-foreground'
            "
            :title="t('sessions.composer.modeTooltip')"
            @click.stop="toggle('mode')"
          >
            <component :is="modeIcon" />
            {{ t(`sessions.mode.${selectedMode}`) }}
            <ChevronDown class="opacity-60" />
          </Button>
          <!-- Menu tự vẽ (neo absolute trên nút). `role="menu"` + `data-state="open"`
               để OVERLAYS (useEmbeddedBrowser.ts) bắt được — xem báo cáo. -->
          <div
            v-if="open === 'mode'"
            role="menu"
            data-state="open"
            class="absolute bottom-[130%] left-0 z-50 max-h-[min(420px,60vh)] min-w-42 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
            @click.stop
          >
            <div
              v-for="m in MODES_UI"
              :key="m.id"
              role="menuitem"
              :class="MENU_ITEM_CLASS"
              @click="selectMode(m.id)"
            >
              <component :is="m.icon" class="size-3.5" />
              {{ t(`sessions.mode.${m.id}`) }}
              <Check v-if="m.id === selectedMode" class="ml-auto size-3.5 text-primary" />
            </div>
          </div>
        </span>
        <!-- Overflow (session-ui-refactor §3.7): nguồn MCP · ghim context · làm đẹp
             prompt. Cả ba đều là cấu hình ĐẶT MỘT LẦN rồi để đó, không phải thao tác
             mỗi lượt như Mode hay đính kèm — nên chúng rời thanh, để composer còn
             đính kèm · Mode · ⋯ · Gửi. Chấm accent trên `⋯` giữ lại tín hiệu trạng
             thái đã mất khi chip biến đi. -->
        <span class="relative shrink-0">
          <Button
            variant="ghost"
            size="iconSm"
            class="relative text-muted-foreground [&_svg]:size-4"
            :class="open === 'more' && 'bg-primary/10 text-primary'"
            :title="t('sessions.composer.more')"
            :aria-label="t('sessions.composer.more')"
            @click.stop="toggle('more')"
          >
            <Ellipsis />
            <span
              v-if="hasPinned"
              class="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.75 text-xs leading-3.5 font-semibold text-primary-foreground tabular-nums"
            >
              {{ pinnedCount }}
            </span>
          </Button>
          <!-- Popover ⋯: danh sách nguồn MCP (inline, không lồng popover) · hàng mở
               popover ghim context · hàng làm đẹp prompt. `role="dialog"` +
               `data-state="open"` khớp OVERLAYS thay cho class `.pop` cũ. -->
          <div
            v-if="open === 'more'"
            role="dialog"
            data-state="open"
            :class="[POP_CLASS, 'w-71 p-3.5']"
            @click.stop
          >
            <SessionMcpChip variant="inline" />
            <Separator class="my-2" />
            <Button variant="ghost" size="sm" :class="MORE_ROW_CLASS" @click="onPinOpen">
              <Pin />
              {{ t('sessions.pinned.title') }}
              <span v-if="pinnedCount > 0" class="ml-auto text-xs text-primary tabular-nums">
                {{ pinnedCount }}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :class="MORE_ROW_CLASS"
              :disabled="enhancing"
              @click="onEnhance"
            >
              <!-- Quay khi đang viết lại (one-shot đang chạy). -->
              <Sparkles :class="enhancing && 'animate-spin motion-reduce:animate-none'" />
              {{ enhancing ? t('sessions.composer.enhancing') : t('sessions.composer.enhance') }}
            </Button>
          </div>
          <!-- Popover ghim context: danh sách file ghim + ô tìm thêm file + ô ghi chú. -->
          <div
            v-if="open === 'pin'"
            role="dialog"
            data-state="open"
            :class="[POP_CLASS, 'flex w-80 max-w-[80vw] flex-col gap-2 p-2.5']"
            @click.stop
          >
            <div class="font-semibold text-foreground">{{ t('sessions.pinned.title') }}</div>
            <div class="-mt-1 text-sm text-muted-foreground">{{ t('sessions.pinned.hint') }}</div>

            <!-- pinned files -->
            <div v-if="pinnedFiles.length" class="flex flex-col gap-0.5">
              <div v-for="f in pinnedFiles" :key="f" :class="PIN_ROW_CLASS">
                <File class="size-3 shrink-0 text-muted-foreground" />
                <!-- mono: đường dẫn file ghim -->
                <span class="min-w-0 flex-1 truncate font-mono text-sm" :title="f">{{ f }}</span>
                <span
                  :class="PIN_X_CLASS"
                  :title="t('sessions.pinned.remove')"
                  @click="removePin(f)"
                >
                  ×
                </span>
              </div>
            </div>

            <!-- applied reusable notes (toggled from the library below, like file pins) -->
            <div v-if="appliedNotes.length" class="flex flex-col gap-0.5">
              <div v-for="(n, i) in appliedNotes" :key="`an${i}`" :class="PIN_ROW_CLASS" :title="n">
                <Pin class="size-3 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ noteLabel(n) }}</span>
                <span
                  :class="PIN_X_CLASS"
                  :title="t('sessions.pinned.remove')"
                  @click="toggleNote(n)"
                >
                  ×
                </span>
              </div>
            </div>

            <!-- add a file (workspace file index, same source as @-mention) -->
            <Input v-model="pinQuery" :placeholder="t('sessions.pinned.searchFiles')" />
            <div v-if="pinFileMatches.length" class="flex max-h-45 flex-col gap-0.5 overflow-auto">
              <div
                v-for="f in pinFileMatches"
                :key="f.path"
                class="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-foreground hover:bg-accent"
                :title="f.path"
                @click="addPin(f.path)"
              >
                <Plus class="size-3 shrink-0 text-muted-foreground" />
                <span class="shrink-0 text-sm">{{ f.name }}</span>
                <!-- mono: đường dẫn file -->
                <span class="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
                  {{ f.path }}
                </span>
              </div>
            </div>

            <!-- notes (persisted on blur) -->
            <Textarea
              v-model="notesDraft"
              class="min-h-14 resize-y px-2 py-1.5 text-sm"
              :placeholder="t('sessions.pinned.notesPlaceholder')"
              rows="3"
              @blur="saveNotes"
            />

            <!-- reusable notes: save the current note as a preset, or apply a saved
                 preset / recent note — a cross-session library (see useSessionNotePresets). -->
            <div class="-mt-0.5 flex items-center gap-1.25">
              <Button
                v-if="!presetNaming"
                variant="outline"
                size="xs"
                class="h-auto gap-1.25 px-2 py-1 text-sm font-normal [&_svg]:size-3"
                :disabled="!notesDraft.trim()"
                :title="t('sessions.pinned.savePresetTitle')"
                @click="startPreset"
              >
                <Pin />
                {{ t('sessions.pinned.savePreset') }}
              </Button>
              <template v-else>
                <Input
                  ref="presetNameInput"
                  v-model="presetName"
                  :placeholder="t('sessions.pinned.presetNamePlaceholder')"
                  class="h-auto min-w-0 flex-1 px-2 py-1 text-sm font-medium"
                  @keydown.enter.prevent="confirmPreset"
                  @keydown.esc.prevent="cancelPreset"
                />
                <Button
                  variant="ghost"
                  size="iconSm"
                  class="size-6.5 shrink-0 text-muted-foreground hover:text-foreground"
                  :title="t('sessions.pinned.savePreset')"
                  :aria-label="t('sessions.pinned.savePreset')"
                  @click="confirmPreset"
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  class="size-6.5 shrink-0 text-muted-foreground hover:text-foreground"
                  :title="t('sessions.pinned.cancelPreset')"
                  :aria-label="t('sessions.pinned.cancelPreset')"
                  @click="cancelPreset"
                >
                  <X />
                </Button>
              </template>
            </div>

            <template v-if="notePresets.length">
              <div class="flex items-center text-sm font-semibold text-muted-foreground">
                {{ t('sessions.pinned.presets') }}
              </div>
              <div class="flex max-h-37.5 flex-col gap-0.5 overflow-auto">
                <!-- Mục đang dùng (khớp ghi chú trong ô) = vòng ring inset, không thêm viền
                     nên không xô layout. -->
                <div
                  v-for="p in notePresets"
                  :key="p.id"
                  :class="isNoteApplied(p.text) ? REUSE_ITEM_ON_CLASS : REUSE_ITEM_CLASS"
                  :title="p.text"
                  @click="toggleNote(p.text)"
                >
                  <Pin class="size-3 shrink-0" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ p.name }}</span>
                  <Check
                    v-if="isNoteApplied(p.text)"
                    :title="t('sessions.pinned.inUse')"
                    class="size-3 shrink-0"
                  />
                  <span
                    :class="PIN_X_CLASS"
                    :title="t('sessions.pinned.deletePreset')"
                    @click.stop="deleteNotePreset(p.id)"
                  >
                    ×
                  </span>
                </div>
              </div>
            </template>

            <template v-if="noteHistory.length">
              <div class="flex items-center text-sm font-semibold text-muted-foreground">
                {{ t('sessions.pinned.recentNotes') }}
                <span
                  class="ml-auto cursor-pointer font-medium text-muted-foreground hover:text-destructive"
                  @click="clearNoteHistory"
                >
                  {{ t('sessions.pinned.clearRecent') }}
                </span>
              </div>
              <div class="flex max-h-37.5 flex-col gap-0.5 overflow-auto">
                <div
                  v-for="(h, i) in noteHistory"
                  :key="i"
                  :class="isNoteApplied(h) ? REUSE_ITEM_ON_CLASS : REUSE_ITEM_CLASS"
                  :title="h"
                  @click="toggleNote(h)"
                >
                  <FileText class="size-3 shrink-0" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {{ noteLabel(h) }}
                  </span>
                  <Check
                    v-if="isNoteApplied(h)"
                    :title="t('sessions.pinned.inUse')"
                    class="size-3 shrink-0"
                  />
                  <span
                    :class="PIN_X_CLASS"
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
        <span class="flex-1" />
        <!-- Draft character counter — proto right-cluster readout (text-sm muted,
             tabular-nums so the digits don't jiggle the send button). -->
        <span class="mr-1 shrink-0 text-sm text-muted-foreground tabular-nums">
          {{ draft.length }}
        </span>
        <!-- Compacting → disabled processing button (Send locked until the RPC ends).
             Idle → Send. While a turn streams → Stop + a split steer/queue button
             (caret opens the alternate action). All icon-only per the proto
             iconSm idiom; labels live on the tooltips. -->
        <span v-if="compacting" class="shrink-0">
          <Button
            disabled
            :title="t('sessions.composer.compacting')"
            class="[&_svg]:size-4"
            variant="default"
            size="iconSm"
          >
            <Loader2 class="animate-spin motion-reduce:animate-none" />
          </Button>
        </span>
        <span v-else-if="!busy" class="shrink-0">
          <Button
            :disabled="!hasContent"
            :title="t('sessions.composer.send')"
            :aria-label="t('sessions.composer.send')"
            class="[&_svg]:size-4"
            variant="default"
            size="iconSm"
            @click="send"
          >
            <SendHorizontal />
          </Button>
        </span>
        <!-- Đang stream: Stop (tô destructive — bấm là huỷ lượt) + nút tách steer/queue. -->
        <span v-else class="inline-flex shrink-0 items-center gap-1.5">
          <Button
            :title="t('sessions.composer.stopTooltip')"
            :aria-label="t('sessions.composer.stopTooltip')"
            class="bg-destructive hover:bg-destructive/90 [&_svg]:size-4"
            variant="default"
            size="iconSm"
            @click="sid != null && store.cancel(sid)"
          >
            <Square fill="currentColor" />
          </Button>
          <span v-if="hasContent" class="relative inline-flex items-stretch">
            <Button
              :title="streamPrimaryTitle"
              :aria-label="streamPrimaryTitle"
              class="rounded-r-none [&_svg]:size-4"
              variant="default"
              size="iconSm"
              @click="onStreamPrimary"
            >
              <component :is="streamPrimaryAction === 'steer' ? SendHorizontal : Clock" />
            </Button>
            <Button
              :title="t('sessions.composer.queue')"
              :aria-label="t('sessions.composer.queue')"
              class="rounded-l-none border-l border-primary-foreground/25 px-1.5 [&_svg]:size-4"
              variant="default"
              size="iconSm"
              @click.stop="sendMenuOpen = !sendMenuOpen"
            >
              <ChevronUp />
            </Button>
            <!-- Menu tách steer/queue, neo phía trên nút. -->
            <div
              v-if="sendMenuOpen"
              role="menu"
              data-state="open"
              class="absolute right-0 bottom-[calc(100%+6px)] z-50 max-h-[min(420px,60vh)] min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
              @click.stop
            >
              <div
                v-if="store.canSteerId(sid)"
                role="menuitem"
                :class="[SEND_ITEM_CLASS, !canSteer && 'pointer-events-none opacity-45']"
                @click="pickSteer"
              >
                <SendHorizontal
                  class="mt-px size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground"
                />
                <div class="flex min-w-0 flex-col gap-0.5">
                  <div class="whitespace-nowrap text-foreground">
                    {{ t('sessions.composer.steer') }}
                  </div>
                  <div class="text-xs whitespace-normal text-muted-foreground">
                    {{ t('sessions.composer.steerHint') }}
                  </div>
                </div>
              </div>
              <div role="menuitem" :class="SEND_ITEM_CLASS" @click="pickQueue">
                <Clock
                  class="mt-px size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground"
                />
                <div class="flex min-w-0 flex-col gap-0.5">
                  <div class="whitespace-nowrap text-foreground">
                    {{ t('sessions.composer.queue') }}
                  </div>
                  <div class="text-xs whitespace-normal text-muted-foreground">
                    {{ t('sessions.composer.queueHint') }}
                  </div>
                </div>
              </div>
            </div>
          </span>
        </span>
      </div>
    </div>
    <div v-if="open" class="fixed inset-0 z-40" @click="open = null" />
    <div v-if="sendMenuOpen" class="fixed inset-0 z-40" @click="sendMenuOpen = false" />
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
// Floor matches the proto Textarea's 52px floor (class `min-h-13` on the composer
// textarea) — one MIN source so the JS clamp and the CSS floor never disagree.
const COMPOSER_MIN_H = 52
// Runtime px equivalent of the textarea's `max-h-[40vh]` class — one source of
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

// ── Class Tailwind dùng lặp trong template (thay skin `.att` / `.smenu .mi` / `.pop` /
// `.pinreuse-item`… cũ). Chỉ là chuỗi class — không logic. Thẻ thường (không qua `cn`)
// nên mỗi cặp bật/tắt phải LOẠI TRỪ nhau, không chồng hai giá trị cùng thuộc tính.
// Chip đính kèm / tin chờ: bo lg, hover wash; nút × / gửi-ngay là badge nổi ở góc,
// hiện khi hover/focus chip (group/att).
const ATT_BASE =
  'group/att relative flex items-center gap-2 rounded-lg border py-1 text-xs tabular-nums transition-colors motion-reduce:transition-none'
const ATT_IDLE =
  'cursor-pointer bg-muted/40 text-muted-foreground hover:border-input hover:bg-accent hover:text-foreground'
const ATT_BADGE =
  'absolute inline-flex size-4 cursor-pointer items-center justify-center rounded-full border bg-popover text-sm leading-3 text-muted-foreground opacity-0 scale-85 transition group-hover/att:scale-100 group-hover/att:opacity-100 group-focus-within/att:scale-100 group-focus-within/att:opacity-100 motion-reduce:transition-none'
const ATT_X_CLASS = `${ATT_BADGE} -top-1.75 -right-1.75 hover:border-destructive hover:bg-destructive hover:text-destructive-foreground`
const QSEND_CLASS = `${ATT_BADGE} -top-1.75 -left-1.75 hover:border-primary hover:bg-primary hover:text-primary-foreground`
// Tab Model | Account trong menu model (đi qua `cn` của Button nên chồng được).
const SEG_CLASS =
  'h-auto min-w-0 flex-1 truncate rounded-sm border border-transparent px-1.5 py-1 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground'
const SEG_ON_CLASS = 'border-ring bg-selected text-primary hover:bg-selected hover:text-primary'
// Menu tự vẽ (Mode, menu Gửi) + popover (⋯, ghim): bề mặt popover, viền mảnh, bo lg,
// cùng trần chiều cao với status bar — dài hơn thì cuộn trong popup.
const MENU_ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground'
const SEND_ITEM_CLASS =
  'group flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground'
const POP_CLASS =
  'absolute right-0 bottom-[130%] z-50 max-h-[min(420px,60vh)] overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-md'
const MORE_ROW_CLASS =
  'h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-sm font-normal text-foreground disabled:opacity-55 [&_svg]:size-3.5 [&_svg]:text-muted-foreground'
const PIN_ROW_CLASS = 'flex items-center gap-1.5 rounded-sm bg-muted px-1.5 py-1 text-foreground'
const PIN_X_CLASS = 'cursor-pointer rounded-sm px-0.5 text-muted-foreground hover:text-destructive'
const REUSE_ITEM_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-foreground hover:bg-accent [&_svg]:text-muted-foreground'
const REUSE_ITEM_ON_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-1.5 py-1 text-primary ring-1 ring-ring ring-inset [&_svg]:text-primary'
</script>
