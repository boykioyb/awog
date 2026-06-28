<template>
  <div class="cluster" :class="{ col: collapsed }">
    <div class="clh" @click="collapsed = !collapsed">
      <Icon name="chev" style="width: 13px; height: 13px" />
      <span class="cln">
        {{ t('sessions.cluster.steps', { n: steps.length }) }} · {{ summary }}
      </span>
    </div>
    <Collapse :open="!collapsed">
      <div class="clbody">
        <SessionStepItem v-for="(s, i) in steps" :key="i" :block="s" />
      </div>
    </Collapse>
  </div>
</template>

<script setup lang="ts">
// clusterHtml (~1446): collapses a run of plain tool steps into one summary row.
import type { StepBlock } from '~/composables/useSessionsData'

const props = defineProps<{ steps: StepBlock[] }>()
const { t } = useI18n()

// Collapsed-by-default: header click toggles the cluster body (.cluster.col hides .clbody).
const collapsed = ref(true)

// Follow the transcript-wide collapse-all / expand-all broadcast (manual clicks
// still toggle locally until the next broadcast).
const fold = useStepFold()
watch(
  () => fold.signal.seq,
  () => {
    collapsed.value = fold.signal.mode !== 'expand'
  },
)

const summary = computed(() => {
  const c: Record<string, number> = {}
  props.steps.forEach((s) => (c[s.tool] = (c[s.tool] || 0) + 1))
  const reads = (c.Read || 0) + (c.Glob || 0) + (c.Grep || 0)
  const edits = (c.Edit || 0) + (c.Write || 0)
  const runs = c.Bash || 0
  const other = props.steps.length - reads - edits - runs
  const p: string[] = []
  if (reads) p.push(t('sessions.cluster.read', { n: reads }))
  if (edits) p.push(t('sessions.cluster.edit', { n: edits }))
  if (runs) p.push(t('sessions.cluster.run', { n: runs }))
  if (other) p.push(t('sessions.cluster.other', { n: other }))
  return p.join(' · ')
})
</script>

<style scoped>
/* Flat clusters: drop the grey fill (prototype .cluster uses var(--bgSubtle));
   keep the hairline border so the grouped run still reads as one unit. */
.cluster {
  background: transparent;
}
/* The <Collapse> wrapper now owns the body's reveal; neutralize the prototype's
   `.cluster.col .clbody{display:none}` snap (scoped → higher specificity wins). */
.cluster.col .clbody {
  display: flex;
}
/* Header is the clickable toggle — give it the same hover feedback as step rows. */
.clh {
  transition: background 0.12s ease;
  border-radius: 8px;
}
.clh:hover {
  background: var(--bgHover);
}
</style>
