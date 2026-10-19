<template>
  <!-- Panel phải của Git Log (kiểu JetBrains): trên là file đổi của commit đang chọn
       (bấm ⇒ mở diff thành tab), dưới là chi tiết commit — message, hash (bấm copy),
       tác giả, ngày, parent (bấm ⇒ nhảy tới commit cha). -->
  <div v-if="!commit" class="px-3 py-3 text-sm text-faint">
    {{ t('wb.gitlog.pick') }}
  </div>
  <div v-else class="flex min-h-0 flex-1 flex-col">
    <div class="flex-none border-b px-3 py-1.5 text-xs font-semibold text-dim">
      {{ t('wb.gitlog.files', { n: files.length }) }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-0.5">
      <div v-if="loading" class="px-3 py-1.5 text-xs text-faint">
        {{ t('wb.gitlog.loading') }}
      </div>
      <div
        v-for="f in files"
        :key="f.f"
        class="flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        role="button"
        tabindex="0"
        :title="f.f"
        @click="emit('open-file', f.f)"
        @keydown.enter.prevent="emit('open-file', f.f)"
      >
        <!-- Chữ trạng thái A/M/D/R — màu theo loại thay đổi, như SCM. -->
        <span
          class="w-3 flex-none text-center text-xs font-semibold"
          :class="ST_CLS[f.st] ?? 'text-warning'"
          :data-st="f.st"
        >
          {{ f.st }}
        </span>
        <span class="truncate text-foreground">{{ baseName(f.f) }}</span>
        <span class="min-w-0 truncate text-xs text-faint">{{ dirName(f.f) }}</span>
      </div>
    </div>

    <div class="max-h-[45%] flex-none overflow-y-auto border-t px-3 py-2.5 text-sm">
      <div class="font-semibold text-foreground">{{ commit.m }}</div>
      <div v-if="commit.body" class="mt-1.5 whitespace-pre-wrap text-dim">{{ commit.body }}</div>
      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
        <Button
          variant="ghost"
          size="xs"
          class="h-auto gap-1 px-1 py-0 text-xs font-normal text-primary hover:text-primary [&_svg]:size-3"
          :title="copyFb.labelFor('sha', t('common.copy'))"
          @click="copyFb.copy('sha', commit.sha ?? commit.h)"
        >
          <!-- mono-ok: commit SHA — chuỗi kỹ thuật người dùng copy -->
          <span class="font-mono">{{ (commit.sha ?? commit.h).slice(0, 10) }}</span>
          <Icon :name="copyFb.iconFor('sha')" class="size-3" />
        </Button>
        <span>
          {{ commit.a }}
          <template v-if="commit.email">&lt;{{ commit.email }}&gt;</template>
        </span>
        <span v-if="commit.at" class="tabular-nums">{{ fullDate(commit.at) }}</span>
      </div>
      <div v-if="commit.parents?.length" class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-faint">{{ t('wb.gitlog.parents') }}</span>
        <Button
          v-for="p in commit.parents"
          :key="p"
          variant="ghost"
          size="xs"
          class="h-auto px-1 py-0 text-xs font-normal text-primary hover:text-primary"
          @click="emit('select', p)"
        >
          <!-- mono-ok: commit SHA -->
          <span class="font-mono">{{ p.slice(0, 7) }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Commit, GitFile } from '~/components/git/git-types'

defineProps<{ commit: Commit | null; files: GitFile[]; loading: boolean }>()
const emit = defineEmits<{ 'open-file': [path: string]; select: [sha: string] }>()
const { t } = useI18n()
const copyFb = useCopyFeedback()

const baseName = (p: string): string => p.split('/').pop() ?? p
const dirName = (p: string): string => p.split('/').slice(0, -1).join('/')
const fullDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

const ST_CLS: Record<string, string> = {
  A: 'text-success',
  D: 'text-destructive',
  R: 'text-info',
}
</script>
