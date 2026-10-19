<template>
  <!-- Follow-up prompt chips — outline pills on the hover wash; sparkles icon marks
       them as model-authored. -->
  <div v-if="visible" class="mt-0.5 flex flex-wrap gap-1.5">
    <Button
      v-for="(o, i) in block.options"
      :key="i"
      variant="outline"
      size="sm"
      class="max-w-full justify-start gap-1.5 text-base font-normal text-muted-foreground hover:border-ring hover:text-foreground motion-reduce:transition-none"
      :title="t('sessionsSurfaces.followups.use')"
      @click="use(o)"
    >
      <Icon name="sparkles" class="size-3 shrink-0 text-primary" />
      <span class="truncate">{{ o }}</span>
    </Button>
  </div>
</template>

<script setup lang="ts">
// Clickable next prompts (#34, suggest_followups) — drawn at the END of the
// message, only once the turn has finished. Both rules live in `grouped` of
// SessionMessageItem (displayBlockOrder + streaming gate, ADR 0096 D3), not here:
// the model now calls the tool BEFORE its final answer, so in `parts` the block
// sits mid-message.
//
// They exist only where they are still an offer: on the LAST message of the
// session, and only until the user starts typing their own message (the draft is
// the signal — they already know what they want to ask). Clicking seeds the
// composer via the same store.seedComposer path as the welcome starters, so the
// user reads/edits before sending; it never sends a turn behind their back.
import type { FollowupsBlock } from '~/composables/useSessionsData'

const props = defineProps<{ block: FollowupsBlock; isLast: boolean }>()
const { t } = useI18n()
const store = useSessionsStore()
const scope = useSessionScope()

const visible = computed(
  () => props.isLast && props.block.options.length > 0 && !(store.active?.draft ?? '').trim(),
)

function use(text: string): void {
  // Gửi kèm phiên của transcript chứa component này: ở chế độ LƯỚI, bấm ở ô nào thì
  // chỉ composer của ô ĐÓ nhận (useSessionScope).
  store.seedComposer(text, scope.sessionId.value)
}
</script>
