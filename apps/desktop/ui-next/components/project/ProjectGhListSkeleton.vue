<template>
  <!-- Loading placeholder for the Issues / PR list while the first gh.list lands.
       Mirrors a real row (line 1: #number + title + state pill, line 2: branch pair
       + chips) with a gentle shimmer, so the tab reads as "loading" instead of
       flashing a bare text line. -->
  <div class="p-1.5" role="status" :aria-label="t('projects.gh.loading')" aria-busy="true">
    <!-- Cùng hộp với hàng thật (px-3 py-2.5 + viền trong suốt) để lúc thay không giật. -->
    <div v-for="row in ROWS" :key="row.id" class="border border-transparent px-3 py-2.5">
      <div class="flex items-center gap-2">
        <Skeleton class="h-3 w-7.5 rounded-sm" />
        <Skeleton class="h-3 rounded-sm" :style="{ width: row.title }" />
        <Skeleton class="ml-auto h-4 w-13 rounded-full" />
      </div>
      <div class="mt-2.5 flex items-center gap-2">
        <Skeleton
          v-for="(w, i) in row.meta"
          :key="i"
          class="h-3.5 rounded-full"
          :style="{ width: w }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentational skeleton — no props/state. ROWS is a static descriptor (title
// width + the meta-line chip widths) so the shape looks organic rather than uniform.
import Skeleton from '~/components/ui/skeleton/Skeleton.vue'

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
