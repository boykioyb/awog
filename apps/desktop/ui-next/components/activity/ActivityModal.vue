<template>
  <Teleport to="body">
    <div class="ovl" :class="{ on: open }" @click.self="closeActivity">
      <div class="setmodal actmodal">
        <div class="actmodalhd">
          <button
            class="iconbtn"
            style="width: 28px; height: 28px"
            :title="t('common.close')"
            @click="closeActivity"
          >
            <Icon name="x" />
          </button>
        </div>
        <div class="actmodalbody">
          <ActivityView v-if="open" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Activity as a modal overlay — Activity moved from a route to the sidebar
// footer (mirrors SettingsModal). The content lives in ActivityView; this is the
// overlay shell: a thin close strip + a scrollable body. ActivityView already
// renders the "Activity" title/filters header, so the strip only carries the
// close affordance. Mounted by ActivityView is gated on `open` so useActivity
// (sidecar fetch) only runs while the modal is shown.
import { onBeforeUnmount, onMounted } from 'vue'

const { t } = useI18n()
const { open, closeActivity } = useActivityModal()

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') closeActivity()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Activity is a single-pane analytics modal — wider than the default .setmodal
   (640px) so the 3-up cards and the 7-column by-model table have room. */
.actmodal {
  width: 1040px;
  max-width: 94vw;
  height: 84vh;
}
/* Thin top strip holding only the close button (the body's own header carries
   the title + filters). flex:0 0 auto so it never scrolls. */
.actmodalhd {
  display: flex;
  justify-content: flex-end;
  padding: 10px 12px 0;
  flex: 0 0 auto;
}
/* Scrollable content region. Negative top margin pulls the body header up under
   the close strip so the title sits where it would on the page. */
.actmodalbody {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 20px 22px;
  margin-top: -6px;
}
</style>
