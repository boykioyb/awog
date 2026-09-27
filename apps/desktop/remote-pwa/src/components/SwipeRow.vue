<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'

// A list row with an iOS-style trailing swipe action. Swipe left reveals a
// destructive action; the first tap ARMS it ("Chắc xoá?"), the second fires
// `del`. Only horizontal drags past the deadzone engage — vertical scrolling
// passes straight through to the list.
const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{
  (e: 'open'): void
  (e: 'close'): void
  (e: 'tap'): void
  (e: 'del'): void
}>()

const ACT_W = 76

const reveal = ref(0)
const engaged = ref(false)
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null
let startX = 0
let startY = 0
let base = 0
let dead = true
let suppressClick = false

const open = computed(() => props.open === true)

function onStart(e: TouchEvent): void {
  const t = e.touches[0]
  startX = t.clientX
  startY = t.clientY
  base = open.value ? ACT_W : 0
  dead = true
}

function onMove(e: TouchEvent): void {
  const t = e.touches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  if (dead) {
    if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return
    // Vertical wins the gesture — let the scroller have it.
    if (Math.abs(dy) > Math.abs(dx)) {
      dead = false
      return
    }
    dead = false
    engaged.value = true
    emit('close') // sibling row snap-close runs through the parent
    base = open.value ? ACT_W : 0
  }
  if (!engaged.value) return
  reveal.value = Math.min(Math.max(base - dx, 0), ACT_W)
  if (e.cancelable) e.preventDefault()
}

function onEnd(): void {
  if (!engaged.value) {
    dead = true
    return
  }
  engaged.value = false
  suppressClick = true
  requestAnimationFrame(() => {
    suppressClick = false
  })
  if (reveal.value > ACT_W * 0.45) {
    reveal.value = ACT_W
    emit('open')
  } else {
    reveal.value = 0
    emit('close')
    disarm()
  }
}

function onClick(): void {
  if (suppressClick) return
  if (open.value) {
    reveal.value = 0
    emit('close')
    disarm()
    return
  }
  emit('tap')
}

function onAct(): void {
  if (!armed.value) {
    armed.value = true
    armTimer = setTimeout(disarm, 2600)
    return
  }
  disarm()
  emit('del')
}

function disarm(): void {
  armed.value = false
  if (armTimer) clearTimeout(armTimer)
  armTimer = null
}
</script>

<template>
  <li class="sw" :class="{ engaged }">
    <div class="acts">
      <button class="act" :class="{ armed }" @click.stop="onAct">
        <Trash2 v-if="!armed" class="icn-md" />
        <span v-else class="sure">Chắc?</span>
      </button>
    </div>
    <div
      class="cont"
      :style="{ transform: `translateX(${-reveal}px)` }"
      @touchstart.passive="onStart"
      @touchmove="onMove"
      @touchend="onEnd"
      @touchcancel="onEnd"
      @click="onClick"
    >
      <slot />
    </div>
  </li>
</template>

<style scoped>
.sw {
  position: relative;
  overflow: hidden;
}
.acts {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
}
.act {
  width: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--danger);
  color: #fff;
  font-weight: 600;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.act.armed {
  /* Confirm state keeps the same red but louder — the label does the work. */
  background: color-mix(in srgb, var(--danger) 82%, black);
}
.cont {
  position: relative;
  z-index: 1;
  background: var(--bg);
  transition: transform 0.18s ease-out;
}
.sw.engaged .cont {
  transition: none;
}
</style>
