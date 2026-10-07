<template>
  <div v-if="visible" class="fups">
    <button
      v-for="(o, i) in block.options"
      :key="i"
      class="fup"
      :title="t('sessionsSurfaces.followups.use')"
      @click="use(o)"
    >
      <Icon name="sparkles" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="fuptext">{{ o }}</span>
    </button>
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

<style scoped>
/* Follow-up prompt chips — outline pills on the hover wash; sparkles icon marks
   them as model-authored. */
.fups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.fup {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.fup:hover {
  background: var(--accent-wash);
  border-color: var(--ring);
  color: var(--foreground);
}
.fup .icn {
  flex: 0 0 auto;
  color: var(--primary);
}
.fuptext {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .fup {
    transition: none;
  }
}
</style>
