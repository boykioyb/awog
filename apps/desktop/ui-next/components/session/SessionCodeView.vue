<template>
  <!-- Hộp code viền mảnh trên nền wash nhạt — cùng chrome ở step body lẫn đứng riêng. -->
  <div class="overflow-hidden rounded-md border bg-muted/40" :class="embedded ? 'm-0' : 'my-1'">
    <!-- When embedded inside a step body the filename header is redundant (the step
         header already names the tool + file), so it's hidden. -->
    <template v-if="!embedded">
      <!-- mono: đường dẫn file đang hiển thị -->
      <div
        class="flex items-center gap-2 bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
      >
        <Icon :name="mode === 'diff' ? 'git' : 'commands'" class="size-3" />
        <span class="min-w-0 truncate">{{ fname }}</span>
        <span class="ml-auto shrink-0 tracking-wide text-faint uppercase">
          {{ mode === 'diff' ? 'diff' : 'ts' }}
        </span>
      </div>
      <Separator />
    </template>

    <!-- Unified diff: one row per line — [new-side line no.] [sign] [content].
         + rows tint success, − rows tint destructive, @@ hunk headers sit muted
         italic on a faint wash (proto diff idiom). -->
    <div v-if="mode === 'diff'" class="overflow-x-auto font-mono text-xs leading-4.5">
      <div
        v-for="(l, i) in lines"
        :key="i"
        class="flex min-w-max"
        :class="
          l.t === '+'
            ? 'bg-success/10 text-success'
            : l.t === '-'
              ? 'bg-destructive/10 text-destructive'
              : l.t === '@'
                ? 'bg-muted/60 text-muted-foreground italic'
                : 'text-muted-foreground'
        "
      >
        <!-- Rãnh số dòng: cột hẹp cố định, chữ nửa độ đậm; cột dấu mang +/−. -->
        <span class="w-8 shrink-0 border-r px-1.5 text-right tabular-nums opacity-50 select-none">
          {{ l.n ?? '' }}
        </span>
        <span class="w-4 shrink-0 text-center select-none">{{ SIGN[l.t] }}</span>
        <span class="pr-3 whitespace-pre">{{ l.s }}</span>
      </div>
    </div>

    <div v-else class="flex overflow-x-auto">
      <pre
        class="m-0 shrink-0 border-r bg-muted p-2 text-right font-mono text-xs leading-4.5 whitespace-pre text-faint select-none"
        >{{ gutter }}</pre
      >
      <pre
        class="m-0 flex-1 px-3 py-2 font-mono text-xs leading-4.5 whitespace-pre text-foreground/90"
        >{{ code }}</pre
      >
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
    // margin so it reads as part of the step (no card-in-card).
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
