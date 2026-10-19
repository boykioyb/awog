<template>
  <!-- Dòng diff luôn wrap (pre-wrap + break-anywhere) để pane không cuộn ngang. -->
  <div class="flex items-start" :class="ROW[line.cls] ?? 'py-px'">
    <span class="w-12 flex-none pr-3 text-right text-faint tabular-nums select-none">
      {{ line.n }}
    </span>
    <span class="min-w-0 flex-auto break-anywhere whitespace-pre-wrap" :class="TEXT[line.cls]">
      <template v-for="(tk, i) in line.tokens" :key="i">
        <span v-if="tk.cls" :class="tk.cls">{{ tk.text }}</span>
        <template v-else>{{ tk.text }}</template>
      </template>
    </span>
    <!-- Nút stage/unstage hunk: pill accent-tint, hover thì fill. -->
    <Button
      v-if="line.cls === 'hunk' && line.hunk !== undefined && !readonly"
      variant="outline"
      size="xs"
      class="ml-auto h-auto flex-none gap-1 rounded-sm border-ring bg-primary/15 px-2 py-px font-normal text-primary transition-colors hover:bg-primary hover:text-primary-foreground motion-reduce:transition-none"
      :title="staged ? t('git.diff.unstageHunk') : t('git.diff.stageHunk')"
      @click.stop="emit('hunk-action', line.hunk)"
    >
      <Icon :name="staged ? 'rewind' : 'plus'" class="size-3" />
      {{ staged ? t('git.diff.unstageHunkBtn') : t('git.diff.stageHunkBtn') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// One diff line. Tokens render as <span class="t-*"> (màu cú pháp toàn cục) / text (no
// v-html). Ô code là pre-wrap, nhưng chế độ condense mặc định của Vue bỏ các khoảng
// trắng chứa xuống dòng giữa các phần tử token, nên token vẫn dính liền — text giữ
// nguyên qua interpolation (thụt lề đầu dòng nằm trong một token thường).
//
// Hunk header rows carry a real button: "Stage hunk" on the unstaged side,
// "Unstage hunk" on the staged side (`staged`). It emits a generic `hunk-action`;
// the viewer maps it to the right store call.
import type { DiffRow } from './git-types'
import Button from '~/components/ui/button/Button.vue'

// `readonly`: diff của một COMMIT (tab Git Log) — không có gì để stage/unstage.
withDefaults(defineProps<{ line: DiffRow; staged?: boolean; readonly?: boolean }>(), {
  staged: false,
  readonly: false,
})

const emit = defineEmits<{ (e: 'hunk-action', hunk: number): void }>()

const { t } = useI18n()

// Kiểu dòng (DiffRow.cls: 'add' | 'del' | 'hunk' | '') → class hàng + class chữ.
// Hàng add/del có thanh màu 2px bên trái (inset shadow, không ăn bề rộng).
const ROW: Record<string, string> = {
  add: 'py-px bg-diff-add/15 shadow-[inset_2px_0_0_var(--color-diff-add)]',
  del: 'py-px bg-diff-del/15 shadow-[inset_2px_0_0_var(--color-diff-del)]',
  hunk: 'border-y bg-muted py-0.5 font-semibold text-muted-foreground',
}
const TEXT: Record<string, string> = { add: 'text-diff-add', del: 'text-diff-del' }
</script>
