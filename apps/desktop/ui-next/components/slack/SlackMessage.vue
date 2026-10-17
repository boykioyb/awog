<template>
  <div class="slk-msg group" :class="{ compact: row.compact, editing }">
    <div class="slk-gutter">
      <template v-if="!row.compact">
        <img
          v-if="author?.avatar"
          :src="author.avatar"
          :alt="name"
          class="slk-avatar"
          draggable="false"
        />
        <span
          v-else
          class="slk-avatar slk-avatar-ph"
          :style="{ background: avatarHue(m.userId ?? name) }"
        >
          {{ nameInitial(name) }}
        </span>
      </template>
      <span v-else class="slk-hovertime tnum" :title="ctx.fullDateOf(m.ts)">
        {{ ctx.timeOf(m.ts) }}
      </span>
    </div>

    <div class="min-w-0 flex-1">
      <div v-if="!row.compact" class="flex items-baseline gap-2">
        <span class="slk-name">{{ name }}</span>
        <span class="slk-time tnum" :title="ctx.fullDateOf(m.ts)">{{ ctx.timeOf(m.ts) }}</span>
        <span v-if="m.subtype === 'thread_broadcast'" class="text-xs text-dim">
          {{ t('slack.message.broadcast') }}
        </span>
      </div>

      <div v-if="editing" class="mt-1 flex flex-col gap-1.5">
        <Textarea ref="editRef" v-model="editText" class="slk-edit resize-y" @keydown="onEditKey" />
        <div class="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" @click="editing = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="saving || !editText.trim()" @click="saveEdit">
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
      <template v-else>
        <SlackMrkdwn v-if="m.text" :text="tr.displayText(m)" />
        <div class="flex items-center gap-2">
          <span v-if="m.editedTs" class="text-xs text-faint">{{ t('slack.message.edited') }}</span>
          <span v-if="tr.isPending(m)" class="text-xs text-faint">
            {{ t('slack.message.translating') }}
          </span>
          <span v-else-if="showsTranslation" class="text-xs text-faint">
            {{ t('slack.message.translated') }}
          </span>
        </div>
      </template>

      <SlackAttachment
        :files="m.files"
        :unfurls="m.unfurls"
        :team-id="teamId"
        :project-id="projectId"
      />
      <SlackReactions
        v-if="m.reactions.length"
        class="mt-1"
        :reactions="m.reactions"
        :team-id="teamId"
        :custom-url="ctx.customEmojiUrl"
        :user-name="ctx.userName"
        @toggle="(n) => ctx.toggleReaction(m, n)"
        @add="(n) => ctx.addReaction(m, n)"
      />
    </div>

    <div v-if="!editing" class="slk-tools">
      <Button
        v-if="m.text"
        variant="ghost"
        size="iconSm"
        :title="
          tr.isOriginal(m) ? t('slack.message.showTranslation') : t('slack.message.showOriginal')
        "
        @click="toggleOriginal"
      >
        <Icon name="globe" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        :title="t('common.copy')"
        @click="ctx.copyMessage(tr.displayText(m))"
      >
        <Icon name="copy" />
      </Button>
      <SlackEmojiPicker
        :team-id="teamId"
        :custom-url="ctx.customEmojiUrl"
        @pick="(n) => ctx.addReaction(m, n)"
      >
        <Button variant="ghost" size="iconSm" :title="t('slack.message.react')">
          <Icon name="smile" />
        </Button>
      </SlackEmojiPicker>
      <DropdownMenu v-if="mine">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="iconSm" :title="t('slack.message.more')">
            <Icon name="dots" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-slack-overlay align="end">
          <DropdownMenuItem @select="startEdit">
            <Icon name="edit" />
            {{ t('slack.message.edit') }}
          </DropdownMenuItem>
          <DropdownMenuItem class="text-destructive" @select="ctx.deleteMessage(m)">
            <Icon name="trash" />
            {{ t('slack.message.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

<script setup lang="ts">
// Một tin trong thread: avatar + tên + giờ (tin gộp thì chỉ còn giờ nhỏ ở lề khi hover),
// thân mrkdwn (bản dịch hoặc gốc), đính kèm, reaction, và thanh nổi khi hover. Sửa tin
// của mình làm tại chỗ; mention trong bản sửa đi cùng đường đổi `@Tên` ↔ `<@U…>` như ô
// trả lời.
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { avatarHue, nameInitial } from '~/utils/avatar-hue'
import type { SlackDraft } from '~/utils/slack-mrkdwn'
import { useSlackCtx } from '~/composables/useSlackManager'
import type { SlackMessageRow } from '~/composables/useSlackMessageActions'

const props = defineProps<{ row: SlackMessageRow; teamId: string; projectId: string | null }>()

const { t } = useI18n()
const ctx = useSlackCtx()
const tr = ctx.translation

const m = computed(() => props.row.m)
const author = computed(() => ctx.userOf(m.value.userId))
const name = computed(() => ctx.authorName(m.value))
const mine = computed(() => ctx.isMine(m.value))
const showsTranslation = computed(() => !tr.isOriginal(m.value) && !!tr.translationOf(m.value))

const editing = ref(false)
const saving = ref(false)
const editText = ref('')
// Mention + token giữ nguyên của bản gốc; chữ trong ô là `editText`.
let editBase: Omit<SlackDraft, 'draft'> = { mentions: [], tokens: [] }
const editRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('editRef')

async function startEdit(): Promise<void> {
  const d = ctx.editDraftOf(m.value)
  editText.value = d.draft
  editBase = { mentions: d.mentions, tokens: d.tokens }
  editing.value = true
  await nextTick()
  editRef.value?.$el.focus()
}

async function saveEdit(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    if (await ctx.saveEdit(m.value, { ...editBase, draft: editText.value })) editing.value = false
  } finally {
    saving.value = false
  }
}

function onEditKey(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (e.key === 'Escape') {
    // preventDefault: Esc huỷ sửa, không được đóng luôn modal Slack bọc ngoài.
    e.preventDefault()
    editing.value = false
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void saveEdit()
  }
}

function toggleOriginal(): void {
  const d = ctx.detail.value
  if (tr.toggleMessage(m.value) && d) {
    tr.ensure(d.thread.id, [m.value], d.thread.projectId).catch((err) =>
      ctx.fail('slack.toast.translateFailed', err),
    )
  }
}
</script>

<style scoped>
.slk-msg {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 6px 20px 6px 16px;
}
.slk-msg.compact {
  padding-top: 1px;
  padding-bottom: 1px;
}
.slk-msg:hover {
  background: var(--bgHover);
}
.slk-msg.editing {
  background: var(--accentDim);
}
.slk-gutter {
  flex: 0 0 38px;
  display: flex;
  justify-content: flex-end;
}
.slk-avatar {
  width: 38px;
  height: 38px;
  border-radius: var(--r-sm);
  object-fit: cover;
}
.slk-avatar-ph {
  display: grid;
  place-items: center;
  color: var(--accentText);
  font-weight: 600;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
}
.slk-hovertime {
  visibility: hidden;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textFaint);
}
.slk-msg:hover .slk-hovertime {
  visibility: visible;
}
.slk-name {
  font-weight: 700;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.slk-time {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.slk-edit {
  min-height: 72px;
}
.slk-tools {
  position: absolute;
  top: -12px;
  right: 16px;
  display: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
  box-shadow: var(--shadow-sm);
}
.slk-msg:hover .slk-tools,
.slk-tools:has([data-state='open']) {
  display: flex;
}
</style>
