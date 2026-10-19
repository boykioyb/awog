<template>
  <!-- Panel chi tiết của node đang chọn: thuộc tính resolver trả về + nút MỞ RỘNG
       đúng node này một bước ("dựng dần", hợp đồng §6). Read-only: panel không có
       hành động ghi nào — graph không có nút ghi. -->
  <aside class="flex w-75 min-w-65 flex-col overflow-hidden border-l bg-sidebar">
    <header class="flex items-center gap-2 border-b px-3 py-2">
      <span class="grid size-5.5 shrink-0 place-items-center rounded-sm bg-selected text-primary">
        <Icon :name="icon" class="size-3.5" />
      </span>
      <span
        class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
        :title="node.label"
      >
        {{ node.label }}
      </span>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim"
        type="button"
        :title="t('infra.graph.panel.close')"
        :aria-label="t('infra.graph.panel.close')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </header>

    <div class="flex flex-wrap gap-1 px-3 pt-2">
      <Badge variant="outline" class="text-muted-foreground">{{ node.service }}</Badge>
      <Badge v-if="node.region" variant="outline" class="text-muted-foreground">
        {{ node.region }}
      </Badge>
      <Badge v-if="isRoot" variant="outline" class="border-selected-border text-primary">
        {{ t('infra.graph.node.root') }}
      </Badge>
      <Badge v-if="node.inferred" variant="outline" class="border-warning text-warning">
        {{ t('infra.graph.node.inferred') }}
      </Badge>
    </div>

    <p
      v-if="node.kind === 'external'"
      class="mx-3 mt-2 rounded-md border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
    >
      {{ t('infra.graph.panel.externalNote') }}
    </p>
    <p
      v-else-if="node.inferred"
      class="mx-3 mt-2 rounded-md border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
    >
      {{ t('infra.graph.panel.inferredNote') }}
    </p>

    <div class="min-h-0 flex-1 overflow-auto px-3 py-2.5">
      <div class="mb-1.5 text-xs text-faint">{{ t('infra.graph.panel.detail') }}</div>
      <dl
        v-if="entries.length"
        class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-xs"
      >
        <template v-for="[key, value] in entries" :key="key">
          <dt class="break-words text-dim">{{ key }}</dt>
          <dd class="break-words text-foreground">{{ value }}</dd>
        </template>
      </dl>
      <p v-else class="text-xs text-dim">{{ t('infra.graph.panel.noDetail') }}</p>
    </div>

    <footer class="border-t px-3 py-2">
      <!-- G4, nửa đầu: node → nhóm log. Nút CHỈ hiện khi sidecar suy được nhóm
           (`logGroup` vắng mặt = không suy được); mời người dùng sang màn Logs với
           một tên nhóm đoán bừa sẽ mở ra một màn trống, và cái trống đó đọc như
           "chặng này không ghi gì". -->
      <Button
        v-if="node.logGroup"
        type="button"
        :title="node.logGroup.value"
        variant="outline"
        size="sm"
        @click="emit('open-logs', node.logGroup)"
      >
        <Icon name="table" />
        {{ t('infra.graph.panel.openLogs') }}
      </Button>
      <Button
        v-if="node.expandable"
        type="button"
        :disabled="expanding"
        :aria-busy="expanding"
        variant="outline"
        size="sm"
        @click="emit('expand', node.id)"
      >
        <Icon
          :name="expanding ? 'refresh' : 'plus'"
          :class="{ 'motion-safe:animate-spin': expanding }"
        />
        {{ expanding ? t('infra.graph.node.expanding') : t('infra.graph.node.expand') }}
      </Button>
      <p v-else class="text-xs text-dim">{{ t('infra.graph.node.noExpand') }}</p>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { graphServiceIcon } from '~/composables/useInfraGraph'
import type { InfraGraphNode } from '~/composables/useInfraGraphApi'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  node: InfraGraphNode
  isRoot: boolean
  /** Lượt mở rộng của CHÍNH node này đang bay. */
  expanding: boolean
}>()

const emit = defineEmits<{
  expand: [id: string]
  close: []
  'open-logs': [group: { kind: 'exact' | 'prefix'; value: string }]
}>()

const { t } = useI18n()

const icon = computed(() => graphServiceIcon(props.node.service))
const entries = computed(() => Object.entries(props.node.detail))
</script>
