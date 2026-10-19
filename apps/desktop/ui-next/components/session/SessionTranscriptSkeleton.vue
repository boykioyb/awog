<template>
  <!-- Loading placeholder for the transcript while an old session's messages are
       fetched (sessions.get). Mirrors the real layout — a right-aligned user
       bubble + left-aligned assistant text lines — with a gentle shimmer, so
       opening a session reads as "loading" instead of flashing the empty welcome. -->
  <div
    class="flex flex-col gap-6 px-2.5 py-6"
    role="status"
    :aria-label="t('sessions.transcript.loading')"
    aria-busy="true"
  >
    <!-- Một message = một cột thanh, rộng hết transcript; căn trái/phải chọn phía. -->
    <div
      v-for="row in ROWS"
      :key="row.id"
      class="flex w-full flex-col gap-2"
      :class="row.side === 'u' ? 'items-end' : 'items-start'"
    >
      <!-- Hàng user = một khối bong bóng bo tròn, góc trên-phải nhỏ như bong bóng
           user thật, để đọc ra ngay là tin gửi đi. -->
      <Skeleton
        v-for="(w, i) in row.widths"
        :key="i"
        class="bg-muted"
        :class="row.side === 'u' ? 'h-10 rounded-2xl rounded-tr-sm' : 'h-2.5 rounded-sm'"
        :style="{ width: w }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentational skeleton — no props/state. ROWS is a tiny static descriptor
// (side + bar widths) so the shape looks organic. Assistant rows render several
// thin text lines; user rows render a single wide bar styled as a bubble.
const { t } = useI18n()

type SkRow = { id: number; side: 'a' | 'u'; widths: string[] }
const ROWS: SkRow[] = [
  { id: 1, side: 'u', widths: ['52%'] },
  { id: 2, side: 'a', widths: ['94%', '85%', '90%', '48%'] },
  { id: 3, side: 'u', widths: ['40%'] },
  { id: 4, side: 'a', widths: ['82%', '91%', '60%'] },
]
</script>
