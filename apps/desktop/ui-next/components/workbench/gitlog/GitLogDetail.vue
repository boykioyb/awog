<template>
  <!-- Panel phải của Git Log (kiểu JetBrains): trên là file đổi của commit đang chọn
       (bấm ⇒ mở diff thành tab), dưới là chi tiết commit — message, hash (bấm copy),
       tác giả, ngày, parent (bấm ⇒ nhảy tới commit cha). -->
  <div v-if="!commit" class="px-3 py-3 text-sm text-[var(--textFaint)]">
    {{ t('wb.gitlog.pick') }}
  </div>
  <div v-else class="flex min-h-0 flex-1 flex-col">
    <div class="glsec-h">
      {{ t('wb.gitlog.files', { n: files.length }) }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-0.5">
      <div v-if="loading" class="px-3 py-1.5 text-xs text-[var(--textFaint)]">
        {{ t('wb.gitlog.loading') }}
      </div>
      <div
        v-for="f in files"
        :key="f.f"
        class="glfile"
        role="button"
        tabindex="0"
        :title="f.f"
        @click="emit('open-file', f.f)"
        @keydown.enter.prevent="emit('open-file', f.f)"
      >
        <span class="glst" :data-st="f.st">{{ f.st }}</span>
        <span class="truncate text-[var(--text)]">{{ baseName(f.f) }}</span>
        <span class="min-w-0 truncate text-xs text-[var(--textFaint)]">{{ dirName(f.f) }}</span>
      </div>
    </div>

    <div class="glinfo">
      <div class="font-semibold text-[var(--text)]">{{ commit.m }}</div>
      <div v-if="commit.body" class="glbody">{{ commit.body }}</div>
      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--textDim)]">
        <button
          type="button"
          class="glsha"
          :title="copyFb.labelFor('sha', t('common.copy'))"
          @click="copyFb.copy('sha', commit.sha ?? commit.h)"
        >
          <!-- mono-ok: commit SHA — chuỗi kỹ thuật người dùng copy -->
          <span class="font-mono">{{ (commit.sha ?? commit.h).slice(0, 10) }}</span>
          <Icon :name="copyFb.iconFor('sha')" class="size-3" />
        </button>
        <span>
          {{ commit.a }}
          <template v-if="commit.email">&lt;{{ commit.email }}&gt;</template>
        </span>
        <span v-if="commit.at" class="tabular-nums">{{ fullDate(commit.at) }}</span>
      </div>
      <div v-if="commit.parents?.length" class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-[var(--textFaint)]">{{ t('wb.gitlog.parents') }}</span>
        <button
          v-for="p in commit.parents"
          :key="p"
          type="button"
          class="glsha"
          @click="emit('select', p)"
        >
          <!-- mono-ok: commit SHA -->
          <span class="font-mono">{{ p.slice(0, 7) }}</span>
        </button>
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
</script>

<style scoped>
.glsec-h {
  flex: none;
  padding: 6px 12px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
  box-shadow: inset 0 -1px 0 var(--border);
}
.glfile {
  display: flex;
  height: 24px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: nowrap;
}
.glfile:hover,
.glfile:focus-visible {
  background: var(--bgHover);
  outline: none;
}
/* Chữ trạng thái A/M/D/R — màu theo loại thay đổi, như SCM. */
.glst {
  width: 12px;
  flex: none;
  text-align: center;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--warning);
}
.glst[data-st='A'] {
  color: var(--success);
}
.glst[data-st='D'] {
  color: var(--destructive);
}
.glst[data-st='R'] {
  color: var(--info);
}
.glinfo {
  flex: none;
  max-height: 45%;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  box-shadow: inset 0 1px 0 var(--border);
}
.glbody {
  margin-top: 6px;
  white-space: pre-wrap;
  color: var(--textDim);
}
.glsha {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}
.glsha:hover {
  background: var(--accent-wash);
}
</style>
