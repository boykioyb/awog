<template>
  <!-- Composer của channel nhóm: '@' mở gợi ý member; chọn một gợi ý chèn
       "@Title " và gom engineId vào mentions gửi kèm (wake qua hộp thư). -->
  <div class="relative">
    <div
      v-if="mentionOpts.length"
      class="mb-1 flex flex-col gap-0.5 rounded-md border border-border bg-popover p-1"
    >
      <Button
        v-for="m in mentionOpts"
        :key="m.engineId"
        variant="ghost"
        size="xs"
        class="justify-start rounded-sm px-2 text-left font-normal text-foreground hover:text-primary"
        @click="pickMention(m)"
      >
        {{ m.title }}
      </Button>
    </div>
    <div class="flex gap-1.5">
      <Input
        v-model="draft"
        :placeholder="t('sessions.workspace.group.channelPh')"
        class="h-ctrl-sm min-w-0 flex-1 px-2.5"
        @keydown.enter.prevent="send"
      />
      <Button
        variant="outline"
        size="iconMd"
        class="shrink-0 text-muted-foreground hover:border-ring hover:text-primary disabled:opacity-45 [&_svg]:size-3.5"
        :disabled="!draft.trim() || sending"
        :aria-label="t('sessions.workspace.group.postChannel')"
        @click="send"
      >
        <Send class="size-3.5" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Composer của channel nhóm (session-teams §8) — post `team.channelPost`
// kind 'chat' kèm mentions. @autocomplete tối giản: token '@' ở ĐUÔI chuỗi mở
// danh bạ; chọn entry chèn "@Title " và ghi engineId để gửi kèm (sidecar wake
// member qua hộp thư). Mất kết nối thì GIỮ draft — người dùng không mất đoạn
// vừa viết vì một RPC hỏng.
import { computed, ref } from 'vue'
import { Send } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useBoardStore } from '~/stores/board'
import type { Session } from '~/composables/useSessionsData'
import Input from '~/components/ui/input/Input.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  // engineId của phiên GỐC nhóm — khoá của file channel.
  rootId: string
  // Member trực tiếp + lead — nguồn gợi ý @mention.
  members: Session[]
  lead: Session
}>()
const emit = defineEmits<{ sent: [] }>()

const { t } = useI18n()
const board = useBoardStore()

const draft = ref('')
const sending = ref(false)
const mentionIds = new Set<string>()

// Danh bạ @: member + lead (bỏ phiên thiếu engineId — không mention được).
const directory = computed<Session[]>(() =>
  [props.lead, ...props.members].filter((s) => !!s.engineId),
)

// Token @ đang gõ: đuôi chuỗi khớp `@<query>` không chứa khoảng trắng.
const mentionTail = computed(() => /@([\p{L}\p{N}_-]*)$/u.exec(draft.value)?.[1] ?? null)
const mentionOpts = computed<Session[]>(() => {
  const q = mentionTail.value
  if (q === null) return []
  const needle = q.toLowerCase()
  return directory.value
    .filter((m) => !mentionIds.has(m.engineId ?? ''))
    .filter((m) => !needle || m.title.toLowerCase().includes(needle))
    .slice(0, 6)
})

// Chèn "@Title " thay cho token đang gõ + gom id vào mentions.
function pickMention(m: Session) {
  if (!m.engineId) return
  draft.value = draft.value.replace(/@([\p{L}\p{N}_-]*)$/u, `@${m.title} `)
  mentionIds.add(m.engineId)
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const ok = await board.postChannel(props.rootId, text, 'chat', [...mentionIds])
    if (ok) {
      draft.value = ''
      mentionIds.clear()
      emit('sent')
    }
  } finally {
    sending.value = false
  }
}
</script>
