<template>
  <!-- Loading placeholder for the transcript while an old session's messages are
       fetched (sessions.get). Mirrors the real layout — a right-aligned user
       bubble + left-aligned assistant text lines — with a gentle shimmer, so
       opening a session reads as "loading" instead of flashing the empty welcome. -->
  <div class="sk" role="status" :aria-label="t('sessions.transcript.loading')" aria-busy="true">
    <div v-for="row in ROWS" :key="row.id" class="skmsg" :class="row.side">
      <div v-for="(w, i) in row.widths" :key="i" class="skbar" :style="{ width: w }" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentational skeleton — no props/state. ROWS is a tiny static descriptor
// (side + bar widths) so the shape looks organic. Assistant rows render several
// thin text lines; user rows render a single wide bar styled as a bubble (CSS).
const { t } = useI18n()

type SkRow = { id: number; side: 'a' | 'u'; widths: string[] }
const ROWS: SkRow[] = [
  { id: 1, side: 'u', widths: ['52%'] },
  { id: 2, side: 'a', widths: ['94%', '85%', '90%', '48%'] },
  { id: 3, side: 'u', widths: ['40%'] },
  { id: 4, side: 'a', widths: ['82%', '91%', '60%'] },
]
</script>

<style scoped>
.sk {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px 10px;
}
/* One message = a column of bars, full transcript width; alignment picks the side. */
.skmsg {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
}
.skmsg.a {
  align-items: flex-start;
}
.skmsg.u {
  align-items: flex-end;
}
/* Shimmer: a soft band swept across via background-position (paint-only — no
   reflow). bgHover base + bgActive band gives a gentle sweep in dark and light. */
.skbar {
  height: 11px;
  border-radius: var(--r-xs);
  background: linear-gradient(90deg, var(--bgHover) 25%, var(--bgActive) 50%, var(--bgHover) 75%);
  background-size: 200% 100%;
  animation: sk-shimmer 1.5s ease-in-out infinite;
}
/* User row → a single rounded bubble block, with the same bottom-right tail as the
   real user bubble (.mu), so it clearly reads as an outgoing message. */
.skmsg.u .skbar {
  height: 40px;
  border-radius: var(--r-panel);
  border-bottom-right-radius: var(--r-xs);
}
@keyframes sk-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skbar {
    animation: none;
    background: var(--bgHover);
  }
}
</style>
