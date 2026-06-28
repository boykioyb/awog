<template>
  <div class="codeview" :class="{ embedded }">
    <!-- When embedded inside a step body the filename header is redundant (the step
         header already names the tool + file), so it's hidden + the card flattens. -->
    <div v-if="!embedded" class="cvhead">
      <Icon :name="mode === 'diff' ? 'git' : 'commands'" style="width: 12px; height: 12px" />
      <span>{{ fname }}</span>
      <span class="cvlang">{{ mode === 'diff' ? 'diff' : 'ts' }}</span>
    </div>

    <div v-if="mode === 'diff'" class="cvdiff">
      <div
        v-for="(l, i) in lines"
        :key="i"
        class="dl"
        :class="{ add: l.t === '+', del: l.t === '-', hunk: l.t === '@' }"
      >
        <span class="dsign">{{ SIGN[l.t] }}</span>
        <span class="gn2">{{ l.n ?? '' }}</span>
        <span class="dc">{{ l.s }}</span>
      </div>
    </div>

    <div v-else class="cvbody">
      <pre class="cvgut">{{ gutter }}</pre>
      <pre class="cvcode">{{ code }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
// codeBlock / diffBlock (prototype ~1866) — shared between step details and the
// workspace panel. Syntax highlight from the prototype's hl() is dropped (visual
// fidelity is preserved by the .cvcode mono styling); plain text avoids v-html.
import type { DiffLine } from '~/composables/useSessionsData'

const props = withDefaults(
  defineProps<{
    fname: string
    mode?: 'code' | 'diff'
    code?: string
    lines?: DiffLine[]
    // Flatten for use inside a step body: hide the filename header + drop the
    // card border/background so it reads as part of the step (no card-in-card).
    embedded?: boolean
  }>(),
  { mode: 'code', code: '', lines: () => [], embedded: false },
)

const gutter = computed(() =>
  Array.from({ length: props.code.split('\n').length }, (_, i) => i + 1).join('\n'),
)

// Per-line change marker shown in the diff gutter (− is U+2212, matching the +N −N badge).
const SIGN: Record<DiffLine['t'], string> = { '+': '+', '-': '−', ' ': '', '@': '' }
</script>

<style scoped>
/* Change-marker column + force the changed-line text color to win over the mono
   default (the global `.dl.add .dc` rule loses the cascade in places, so re-assert
   it here — scoped data-attr raises specificity). */
.dsign {
  width: 15px;
  flex: 0 0 auto;
  text-align: center;
  user-select: none;
  font-family: var(--code);
  font-weight: 700;
  color: var(--textFaint);
}
.dl.add .dsign,
.dl.add .dc {
  color: var(--add);
}
.dl.del .dsign,
.dl.del .dc {
  color: var(--del);
}
/* Embedded (inside a step body): flush — no card border/bg/radius, no margin. */
.codeview.embedded {
  border: none;
  border-radius: 0;
  background: transparent;
  margin: 0;
}
</style>
