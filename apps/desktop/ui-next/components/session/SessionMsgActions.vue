<template>
  <div class="hoveract bottom">
    <span
      v-for="a in primary"
      :key="a.icon"
      class="ha"
      :class="{ danger: a.danger, on: a.active, off: a.disabled }"
      :title="a.title"
      @click="a.run"
    >
      <Icon :name="a.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </span>

    <!-- Overflow. Everything rare or destructive lives here (session-ui-refactor §3.3):
         a destructive action must never sit unlabelled next to `copy` at the same
         weight. Anchored to this span, opening UPWARD because the footer is the last
         row of a turn — a downward menu would fall off the transcript. -->
    <span v-if="overflow.length" class="hamore">
      <span
        class="ha"
        :class="{ on: open }"
        :title="t('sessions.message.more')"
        @click.stop="open = !open"
      >
        <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
      <div v-if="open" class="habackdrop" @click.stop="open = false" />
      <div v-if="open" class="smenu hamenu" @click.stop>
        <template v-for="(a, i) in overflow" :key="i">
          <div v-if="'sep' in a" class="hasep" />
          <div v-else class="mi" :class="{ dmi: a.danger }" @click="run(a)">
            <Icon :name="a.icon" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ a.title }}
          </div>
        </template>
      </div>
    </span>
  </div>
</template>

<script setup lang="ts">
// Action set below one transcript turn. Three controls stay inline (copy · quote ·
// bookmark for the assistant, copy · fullscreen · bookmark for the user); everything
// rare or transcript-cutting moves behind `⋯`.
//
// Owning this as a component (rather than two hard-coded rows in SessionMessageItem)
// keeps the user and assistant footers identical by construction — they drifted apart
// before, one carrying 7 controls and the other 10.
import { ref } from 'vue'

export type MsgAction = {
  icon: string
  title: string
  run: () => void
  danger?: boolean
  active?: boolean
  disabled?: boolean
}
/** A hairline rule inside the overflow menu — separates the transcript-cutting group. */
export type MsgSep = { sep: true }

defineProps<{ primary: MsgAction[]; overflow: (MsgAction | MsgSep)[] }>()

const { t } = useI18n()
const open = ref(false)

function run(a: MsgAction) {
  open.value = false
  a.run()
}
</script>

<style scoped>
.hamore {
  position: relative;
  display: inline-flex;
}
/* Click-away catcher. Below the menu, above everything else in the transcript. */
.habackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
/* `.smenu` is `position: fixed` in the prototype sheet; this one is anchored to its
   own button instead, opening upward (the footer is the last row of the turn). */
.hamenu {
  position: absolute;
  bottom: 130%;
  right: 0;
  z-index: 50;
  min-width: 196px;
}
.hasep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
