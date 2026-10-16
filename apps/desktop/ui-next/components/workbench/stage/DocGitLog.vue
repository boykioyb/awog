<template>
  <!-- Doc 'gitlog' — Git Log kiểu JetBrains cho project của tab: thanh lọc (text ·
       mọi branch / branch hiện tại · nạp lại), bảng log có graph bên trái, file đổi +
       chi tiết commit bên phải. Bấm file ⇒ diff của file trong commit mở thành tab
       'cdiff'. State ở useGitLog. -->
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-10 flex-none items-center gap-2 px-2 shadow-[inset_0_-1px_0_var(--border)]">
      <Input v-model="query" class="h-7 w-64" type="search" :placeholder="t('wb.gitlog.search')" />
      <Tabs :model-value="scope" @update:model-value="(v) => (scope = v as GitLogScope)">
        <TabsList class="h-7">
          <TabsTrigger value="all" class="px-2.5 py-0.5 text-xs">
            {{ t('wb.gitlog.all') }}
          </TabsTrigger>
          <TabsTrigger value="current" class="px-2.5 py-0.5 text-xs">
            {{ t('wb.gitlog.current') }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="iconSm"
        :title="t('wb.gitlog.reload')"
        :aria-label="t('wb.gitlog.reload')"
        :disabled="loading"
        @click="reload()"
      >
        <RefreshCw class="size-4" :class="{ 'animate-spin': loading }" />
      </Button>
    </div>

    <div class="flex min-h-0 flex-1">
      <GitLogTable
        :rows="rows"
        :graph-width="graphWidth"
        :selected="selected"
        :has-more="hasMore"
        :loading="loading"
        @select="(sha) => (selected = sha)"
        @load-more="loadMore()"
        @step="step"
      />
      <div
        class="flex w-[38%] min-w-[280px] max-w-[520px] flex-none flex-col shadow-[inset_1px_0_0_var(--border)]"
      >
        <GitLogDetail
          :commit="selectedCommit"
          :files="detail?.files ?? []"
          :loading="detailLoading"
          @open-file="openFile"
          @select="(sha) => (selected = sha)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import type { GitLogScope } from '~/composables/useGitLog'
import type { WorkbenchDoc } from '~/types/workbench'
import GitLogDetail from '../gitlog/GitLogDetail.vue'
import GitLogTable from '../gitlog/GitLogTable.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()
const { t } = useI18n()
const wbDocs = useWorkbenchDocs()

const projectId = computed(() => props.doc.id.replace(/^gitlog:/, ''))

const {
  rows,
  graphWidth,
  hasMore,
  loading,
  scope,
  query,
  selected,
  selectedCommit,
  detail,
  detailLoading,
  reload,
  loadMore,
  step,
} = useGitLog(() => props.doc.focusSha)

function openFile(path: string): void {
  if (selected.value) wbDocs.openCommitDiff(projectId.value, selected.value, path)
}
</script>
