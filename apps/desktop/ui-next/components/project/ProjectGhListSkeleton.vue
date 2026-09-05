<template>
  <!-- Loading placeholder for the Issues / PR list while the first gh.list lands.
       Mirrors a real row (line 1: #number + title + state pill, line 2: branch pair
       + chips) with a gentle shimmer, so the tab reads as "loading" instead of
       flashing a bare text line. -->
  <div class="ghsk" role="status" :aria-label="t('projects.gh.loading')" aria-busy="true">
    <div v-for="row in ROWS" :key="row.id" class="ghskrow">
      <div class="ghskl">
        <div class="ghskbar" style="width: 30px" />
        <div class="ghskbar" :style="{ width: row.title }" />
        <div class="ghskbar ghskpill" />
      </div>
      <div class="ghskl ghskl2">
        <div v-for="(w, i) in row.meta" :key="i" class="ghskbar ghskchip" :style="{ width: w }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentational skeleton — no props/state. ROWS is a static descriptor (title
// width + the meta-line chip widths) so the shape looks organic rather than uniform.
const { t } = useI18n()

type GhSkRow = { id: number; title: string; meta: string[] }
const ROWS: GhSkRow[] = [
  { id: 1, title: '58%', meta: ['180px', '74px', '92px'] },
  { id: 2, title: '42%', meta: ['150px', '68px'] },
  { id: 3, title: '66%', meta: ['210px', '80px', '66px'] },
  { id: 4, title: '36%', meta: ['160px'] },
  { id: 5, title: '52%', meta: ['190px', '72px'] },
]
</script>

<style scoped>
.ghsk {
  padding: 6px;
}
/* Same box metrics as .ghrow (prototype.css) so the swap to real rows doesn't jump. */
.ghskrow {
  padding: 10px 12px;
  border: 1px solid transparent;
}
.ghskl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ghskl2 {
  margin-top: 10px;
}
/* Shimmer: a soft band swept via background-position (paint-only — no reflow). */
.ghskbar {
  height: 11px;
  border-radius: var(--r-xs);
  background: linear-gradient(90deg, var(--bgHover) 25%, var(--bgActive) 50%, var(--bgHover) 75%);
  background-size: 200% 100%;
  animation: ghsk-shimmer 1.5s ease-in-out infinite;
}
/* State badge on line 1 sits at the right edge, like the real .ghstate pill. */
.ghskpill {
  width: 52px;
  height: 15px;
  border-radius: var(--r-pill);
  margin-left: auto;
}
.ghskchip {
  height: 14px;
  border-radius: var(--r-pill);
}
@keyframes ghsk-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ghskbar {
    animation: none;
    background: var(--bgHover);
  }
}
</style>
