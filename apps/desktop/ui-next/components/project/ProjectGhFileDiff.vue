<template>
  <!-- mono-ok: nội dung diff là code -->
  <div class="bg-muted font-mono text-xs">
    <div v-if="!rows.length" class="px-3 py-2 text-dim">{{ t('projects.drawer.diffEmpty') }}</div>
    <template v-else>
      <!-- Hàng flex (không phải table) để ô code wrap ổn định còn gutter cố định bề
           rộng + bám đỉnh. GitHub tô màu cả HÀNG, không tô chữ. -->
      <div
        v-for="(r, i) in rows"
        :key="i"
        class="flex items-start"
        :class="{ 'bg-diff-add/15': r.type === 'add', 'bg-diff-del/15': r.type === 'del' }"
      >
        <div
          v-if="r.type === 'hunk'"
          class="min-w-0 flex-1 bg-muted px-2.5 py-0.5 break-anywhere whitespace-pre-wrap text-dim"
        >
          {{ r.text }}
        </div>
        <template v-else>
          <span class="w-8.5 flex-none px-2 text-right whitespace-nowrap text-faint select-none">
            {{ r.oldNo }}
          </span>
          <span
            class="w-8.5 flex-none border-r px-2 text-right whitespace-nowrap text-faint select-none"
          >
            {{ r.newNo }}
          </span>
          <!-- Single interpolation in a pre-wrap cell — keep on one line so no markup
               whitespace leaks into the rendered diff. -->
          <span class="min-w-0 flex-1 px-2.5 break-anywhere whitespace-pre-wrap text-foreground">
            {{ r.text }}
          </span>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Read-only per-file unified-diff view (GitHub style): two line-number gutters
// (old / new), hunk-header rows, and background-coloured add/del rows. The leading
// +/-/space marker stays in the code cell (like GitHub). Long lines WRAP (pre-wrap)
// so the pane never scrolls horizontally; the gutter stays top-aligned. `patch` is
// one file's hunk body (split out of `gh.diff` by useProjectGh.parseUnifiedDiff).
// Interpolation only (never v-html).
const props = defineProps<{ patch: string }>()

const { t } = useI18n()

type DiffRow = { type: 'hunk' | 'add' | 'del' | 'ctx'; oldNo: string; newNo: string; text: string }

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const rows = computed<DiffRow[]>(() => {
  if (!props.patch) return []
  let oldNo = 0
  let newNo = 0
  return props.patch.split('\n').map((raw): DiffRow => {
    if (raw.startsWith('@@')) {
      const m = HUNK_RE.exec(raw)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      return { type: 'hunk', oldNo: '', newNo: '', text: raw }
    }
    if (raw.startsWith('+')) {
      const row: DiffRow = { type: 'add', oldNo: '', newNo: String(newNo), text: raw }
      newNo += 1
      return row
    }
    if (raw.startsWith('-')) {
      const row: DiffRow = { type: 'del', oldNo: String(oldNo), newNo: '', text: raw }
      oldNo += 1
      return row
    }
    const row: DiffRow = { type: 'ctx', oldNo: String(oldNo), newNo: String(newNo), text: raw }
    oldNo += 1
    newNo += 1
    return row
  })
})
</script>
