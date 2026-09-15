<template>
  <div class="chapnav">
    <button
      class="chapbtn"
      :class="{ on: open }"
      :title="t('sessionsSurfaces.chapters.tooltip')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="listol" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </button>
    <Transition name="fadepop">
      <div v-if="open" class="chaplist" @click.stop>
        <div class="chaphead">{{ t('sessionsSurfaces.chapters.title') }}</div>
        <button
          v-for="(c, i) in chapters"
          :key="`${c.msgIndex}-${i}`"
          class="chaprow"
          @click="jump(c.msgIndex)"
        >
          <span class="chapn">{{ i + 1 }}</span>
          <span class="chapt">{{ c.title }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// Floating chapter menu for the transcript (#24). Lists the chapters the model
// marked and jumps to the message each one sits in.
//
// The jump goes through useSessionScroll — the ONE contract that grows the render
// window first and queries inside the transcript root of THIS surface (ADR 0074 §Q2
// + ADR 0075). No document.querySelector, no template ref, no scroll maths here.
export type ChapterEntry = { title: string; msgIndex: number }

defineProps<{ chapters: ChapterEntry[] }>()
const { t } = useI18n()
const { scrollToMessage } = useSessionScroll()

const open = ref(false)

async function jump(msgIndex: number): Promise<void> {
  open.value = false
  await scrollToMessage(msgIndex)
}

// Click anywhere else closes the menu. The toggle + the panel stop propagation, so
// this only ever fires for a click outside them.
function closeOnOutside(): void {
  open.value = false
}
onMounted(() => document.addEventListener('click', closeOnOutside))
onUnmounted(() => document.removeEventListener('click', closeOnOutside))
</script>

<style scoped>
.chapnav {
  position: absolute;
  top: 10px;
  right: 52px;
  z-index: 4;
}
.chapbtn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--textDim);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  opacity: 0.72;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}
.chapbtn:hover {
  opacity: 1;
  background: var(--bgHover);
  border-color: var(--borderStrong);
  color: var(--text);
}
.chapbtn.on {
  opacity: 1;
  color: var(--accent);
  border-color: var(--accent);
}
.chaplist {
  position: absolute;
  top: 34px;
  right: 0;
  width: 260px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--r-sm);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
}
.chaphead {
  padding: 4px 8px 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.chaprow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.chaprow:hover {
  background: var(--bgHover);
}
.chapn {
  flex: 0 0 auto;
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.chapt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fadepop-enter-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}
.fadepop-leave-active {
  transition:
    opacity 0.1s ease-in,
    transform 0.1s ease-in;
}
.fadepop-enter-from,
.fadepop-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
@media (prefers-reduced-motion: reduce) {
  .chapbtn,
  .fadepop-enter-active,
  .fadepop-leave-active {
    transition: none;
  }
  .fadepop-enter-from,
  .fadepop-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
