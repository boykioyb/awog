<template>
  <div class="slk-composer">
    <div v-if="c.suggestions.value.length" class="slk-suggest" data-slack-overlay role="listbox">
      <Button
        v-for="(s, i) in c.suggestions.value"
        :key="s.key"
        variant="ghost"
        size="sm"
        class="slk-sopt"
        :class="{ on: i === c.activeIndex.value }"
        role="option"
        :aria-selected="i === c.activeIndex.value"
        @mousedown.prevent="c.pick(s)"
      >
        <template v-if="s.kind === 'user'">
          <img v-if="s.avatar" :src="s.avatar" alt="" class="slk-savatar" />
          <span class="font-medium">{{ s.label }}</span>
          <span class="truncate text-dim">{{ s.sub }}</span>
        </template>
        <template v-else>
          <img v-if="s.url" :src="s.url" alt="" class="slk-savatar" />
          <span v-else>{{ s.char }}</span>
          <span>:{{ s.label }}:</span>
        </template>
      </Button>
    </div>

    <div v-if="c.hasPendingAgentDraft.value" class="slk-trbar" role="status">
      <Icon name="bot" />
      <span class="flex-1">{{ t('slack.composer.agentDraftPending') }}</span>
      <Button variant="ghost" size="xs" @click="c.acceptAgentDraft">
        {{ t('slack.composer.agentDraftReplace') }}
      </Button>
      <Button variant="ghost" size="xs" @click="c.dismissAgentDraft">
        {{ t('slack.composer.agentDraftDismiss') }}
      </Button>
    </div>

    <div v-if="c.isPreviewingTranslation.value" class="slk-trbar">
      <Icon name="globe" />
      <span class="flex-1">{{ t('slack.composer.translatedPreview') }}</span>
      <Button variant="ghost" size="xs" @click="c.restoreOriginal">
        {{ t('slack.composer.restore') }}
      </Button>
    </div>

    <!-- Textarea thường (không dùng contenteditable): mention hiện dạng `@Tên`, đổi sang
         `<@U…>` lúc gửi. resize-y theo quy ước editor; vẫn chặn kéo quá cao bằng max-h. -->
    <Textarea
      ref="taRef"
      v-model="c.draft.value"
      class="slk-ta resize-y"
      :placeholder="t('slack.composer.placeholder', { channel: thread.channelName })"
      :disabled="c.sending.value"
      @input="c.onInput"
      @click="c.onInput"
      @keydown="c.onKeydown"
      @blur="c.closeSuggestions"
    />

    <div class="flex items-center gap-2">
      <AppCheckbox :checked="c.broadcast.value" @update:checked="(v) => (c.broadcast.value = v)" />
      <span class="text-xs text-dim">
        {{ t('slack.composer.broadcast', { channel: thread.channelName }) }}
      </span>
      <span class="flex-1" />
      <!-- Nút dịch tách đôi: bấm phần chữ = dịch theo lựa chọn đang nhớ; mũi tên = chọn
           ngôn ngữ (Nhật / Anh / Việt / Nhật + Anh) rồi dịch luôn. -->
      <div class="flex items-center">
        <Button
          variant="outline"
          size="sm"
          class="rounded-r-none"
          :disabled="!c.draft.value.trim() || c.translating.value || c.sending.value"
          @click="() => c.translateOutgoing()"
        >
          <Icon name="globe" />
          {{
            c.translating.value
              ? t('slack.composer.translating')
              : t('slack.composer.translateTo', { lang: c.sendLangCode.value })
          }}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="-ml-px rounded-l-none px-1.5"
              :disabled="c.translating.value || c.sending.value"
              :title="t('slack.composer.chooseLang')"
              :aria-label="t('slack.composer.chooseLang')"
            >
              <Icon name="chev" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-slack-overlay align="end" side="top">
            <DropdownMenuLabel>{{ t('slack.composer.translateInto') }}</DropdownMenuLabel>
            <DropdownMenuItem
              v-for="ch in c.sendChoices"
              :key="ch.langs.join('+')"
              :disabled="!c.draft.value.trim()"
              @select="c.translateTo(ch.langs)"
            >
              {{ t(ch.labelKey) }}
              <Icon
                v-if="ch.langs.join('+') === c.sendChoiceCurrent.value"
                name="check"
                class="ml-auto"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button size="sm" :disabled="!c.canSend.value" @click="c.send">
        <Icon name="send" />
        {{ c.sending.value ? t('slack.composer.sending') : t('slack.composer.send') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Ô trả lời của thread đang mở. Toàn bộ logic ở useSlackComposer; ở đây chỉ bind.
import { useTemplateRef } from 'vue'
import { useSlackComposer } from '~/composables/useSlackComposer'
import { useSlackCtx } from '~/composables/useSlackManager'
import type { SlackThread } from '~/stores/slack'

defineProps<{ thread: SlackThread }>()

const { t } = useI18n()
const ctx = useSlackCtx()
const taRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('taRef')

const c = useSlackComposer({
  thread: ctx.selected,
  detail: ctx.detail,
  userName: ctx.userName,
  userRealName: ctx.userRealName,
  textarea: () => taRef.value?.$el ?? null,
  onSent: ctx.reloadSelected,
  fail: ctx.fail,
})
</script>

<style scoped>
.slk-composer {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 16px 12px;
  box-shadow: inset 0 1px 0 var(--border);
}
.slk-ta {
  min-height: 64px;
  max-height: 240px;
}
.slk-trbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-sm);
  background: var(--accentDim);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.slk-suggest {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% - 4px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
  box-shadow: var(--shadow-md);
}
.slk-sopt {
  justify-content: flex-start;
  gap: 8px;
}
.slk-sopt.on {
  background: var(--accentDim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.slk-savatar {
  width: 20px;
  height: 20px;
  border-radius: var(--r-xs);
  object-fit: cover;
}
</style>
