<template>
  <!-- SƠ ĐỒ BA HÀNG (việc 5.5) — phần chính của trang, không phải trang trí.
       Ba hàng xếp chồng, CÙNG một trục ngang là thứ tự bước:
         1. bước            — thẻ bước: số thứ tự · verb · tên · cảnh báo
         2. dịch vụ bị chạm — tô theo LỚP LỆNH của hành động
         3. ảnh hưởng lan   — suy từ graph kiến trúc thật (A1), KHÔNG bịa
       Vẽ bằng layout CSS (không thêm thư viện): mỗi hàng là một flex track, mỗi cột
       rộng CỐ ĐỊNH (`COL` trong script — khai MỘT lần) nên ba hàng thẳng cột với nhau
       mà không cần đo gì. -->
  <section class="flex flex-col gap-1.5 rounded-xl border bg-muted px-3 pt-2.5 pb-3">
    <div class="flex flex-wrap items-center gap-2.5">
      <span class="text-sm font-semibold text-muted-foreground">
        {{ t('playbooks.diagram.title') }}
      </span>
      <span class="ml-auto flex items-center gap-1">
        <Badge variant="outline" class="rounded-sm font-medium" :class="VERB_CLASS.read">
          {{ t('playbooks.diagram.legend.read') }}
        </Badge>
        <Badge variant="outline" class="rounded-sm font-medium" :class="VERB_CLASS.write">
          {{ t('playbooks.diagram.legend.write') }}
        </Badge>
        <Badge variant="outline" class="rounded-sm font-medium" :class="VERB_CLASS.destructive">
          {{ t('playbooks.diagram.legend.destructive') }}
        </Badge>
      </span>
    </div>

    <!-- Hàng 1 — bước -->
    <div class="flex min-w-0 items-stretch gap-2">
      <div class="shrink-0 basis-24 pt-1.5 text-xs text-dim">
        {{ t('playbooks.diagram.row.step') }}
      </div>
      <!-- Track cuộn ngang khi playbook nhiều bước — ba hàng cuộn bằng nhau vì cùng
           bề rộng cột, cùng khoảng cách, cùng điểm bắt đầu. -->
      <div class="flex min-w-0 items-stretch gap-2 overflow-x-auto pb-0.5">
        <div
          v-for="col in columns"
          :key="col.step.id"
          class="flex min-w-0 items-start gap-1.5 rounded-md border bg-card px-2 py-1.5"
          :class="COL"
        >
          <span class="min-w-4 shrink-0 text-xs text-faint tabular-nums">{{ col.index + 1 }}</span>
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="truncate text-sm text-foreground" :title="col.step.title">
              {{ col.step.title }}
            </span>
            <span class="flex items-center gap-1">
              <Badge
                variant="outline"
                class="rounded-sm font-medium"
                :class="VERB_CLASS[col.klass]"
              >
                {{ t(`playbooks.verb.${col.step.verb}`) }}
              </Badge>
              <span v-if="col.state" class="text-xs" :class="STATE_CLASS[col.state] ?? 'text-dim'">
                {{ t(`playbooks.run.state.${col.state}`) }}
              </span>
            </span>
          </span>
          <span
            v-for="key in col.warnKeys"
            :key="key"
            class="inline-flex shrink-0 text-warning"
            :title="t(key)"
            role="img"
            :aria-label="t(key)"
          >
            <Icon name="alert" class="size-3" />
          </span>
        </div>
      </div>
    </div>

    <!-- Hàng 2 — dịch vụ bị chạm -->
    <div class="flex min-w-0 items-stretch gap-2">
      <div class="shrink-0 basis-24 pt-1.5 text-xs text-dim">
        {{ t('playbooks.diagram.row.service') }}
      </div>
      <div class="flex min-w-0 items-stretch gap-2 overflow-x-auto pb-0.5">
        <div
          v-for="col in columns"
          :key="col.step.id"
          class="flex min-w-0 flex-wrap items-start gap-1 rounded-md border border-dashed px-2 py-1"
          :class="COL"
        >
          <template v-if="col.services.length">
            <Badge
              v-for="svc in col.services"
              :key="svc"
              variant="outline"
              class="rounded-sm font-medium"
              :class="VERB_CLASS[col.klass]"
            >
              {{ svc }}
            </Badge>
          </template>
          <span v-else class="text-xs text-faint" :title="t('playbooks.diagram.service.none')">
            —
          </span>
        </div>
      </div>
    </div>

    <!-- Hàng 3 — ảnh hưởng lan -->
    <div class="flex min-w-0 items-stretch gap-2">
      <div class="shrink-0 basis-24 pt-1.5 text-xs text-dim">
        {{ t('playbooks.diagram.row.impact') }}
      </div>

      <div
        v-if="graphState === 'ready'"
        class="flex min-w-0 items-stretch gap-2 overflow-x-auto pb-0.5"
      >
        <div
          v-for="col in columns"
          :key="col.step.id"
          class="flex min-w-0 flex-wrap items-start gap-1 rounded-md border px-2 py-1"
          :class="COL"
        >
          <template v-if="col.impact.length">
            <!-- Cạnh suy luận vẽ NÉT ĐỨT (hợp đồng §3) — ở đây là chip viền đứt. -->
            <Badge
              v-for="node in col.impact"
              :key="node.id"
              variant="outline"
              class="rounded-sm font-medium"
              :class="node.inferred ? 'border-dashed text-dim' : 'text-muted-foreground'"
              :title="node.inferred ? t('playbooks.diagram.impact.inferred') : node.service"
            >
              {{ node.label }}
            </Badge>
          </template>
          <span v-else class="text-xs text-faint" :title="t('playbooks.diagram.impact.none')">
            —
          </span>
        </div>
      </div>

      <!-- Trạng thái của hàng 3 khi chưa có graph. Mỗi trạng thái nói CÁCH SỬA (luật 3):
           chưa dựng thì mời dựng, hỏng thì mời thử lại, rỗng thì nói vì sao rỗng. -->
      <div
        v-else
        class="flex min-w-0 flex-col items-start gap-1 rounded-md border border-dashed px-2.5 py-2"
      >
        <template v-if="graphState === 'loading'">
          <span class="text-xs leading-(--lh-sm) text-muted-foreground">
            {{ t('playbooks.diagram.impact.loading') }}
          </span>
        </template>

        <template v-else-if="graphState === 'unavailable'">
          <span class="text-xs leading-(--lh-sm) font-semibold text-foreground">
            {{ t('playbooks.diagram.impact.unavailable.title') }}
          </span>
          <span class="text-xs leading-(--lh-sm) text-dim">
            {{ graphMessage || t('playbooks.diagram.impact.unavailable.hint') }}
          </span>
          <Button type="button" variant="outline" size="sm" @click="emit('openGraph')">
            <Icon name="layers" />
            {{ t('playbooks.diagram.impact.gotoGraph') }}
          </Button>
        </template>

        <template v-else-if="graphState === 'error'">
          <span class="text-xs leading-(--lh-sm) text-muted-foreground">{{ graphMessage }}</span>
          <Button type="button" variant="outline" size="sm" @click="emit('resolveImpact')">
            {{ t('playbooks.list.retry') }}
          </Button>
        </template>

        <template v-else>
          <span class="text-xs leading-(--lh-sm) text-muted-foreground">
            {{ t('playbooks.diagram.impact.hint') }}
          </span>
          <span class="text-xs leading-(--lh-sm) text-dim">
            {{ t('playbooks.diagram.impact.buildHint') }}
          </span>
          <Button type="button" variant="outline" size="sm" @click="emit('resolveImpact')">
            <Icon name="scan" />
            {{ t('playbooks.diagram.impact.action') }}
          </Button>
        </template>
      </div>
    </div>

    <!-- Nguồn traffic PHẢI nói ra (hợp đồng §3): ảnh hưởng suy từ CloudWatch khác
         hẳn suy từ X-Ray, và người đọc cần biết mình đang tin cái nào. -->
    <p v-if="graphState === 'ready' && graph" class="flex items-center gap-1.5 text-xs text-dim">
      {{
        t('playbooks.diagram.impact.traffic', {
          source: t(`playbooks.diagram.traffic.${graph.trafficSource}`),
        })
      }}
      <span v-if="graph.truncated" class="text-warning">
        · {{ t('playbooks.diagram.impact.truncated') }}
      </span>
      <Button
        variant="link"
        size="xs"
        class="h-auto p-0 font-normal"
        @click="emit('resolveImpact')"
      >
        {{ t('playbooks.list.retry') }}
      </Button>
    </p>

    <!-- Những thứ resolver ĐÃ BỎ QUA — nói ra thay vì để "ảnh hưởng lan ngắn" bị đọc
         thành "không có gì phụ thuộc". `notes` là khoá i18n, không phải câu tiếng Anh. -->
    <p v-if="graphState === 'ready' && graph?.notes.length" class="flex flex-col gap-0.5">
      <span v-for="note in graph.notes" :key="note" class="text-xs leading-(--lh-sm) text-dim">
        {{ t(note) }}
      </span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookDiagramColumn, PlaybookGraphState } from '~/composables/usePlaybooksManager'
import type { InfraGraph } from '~/composables/useInfraGraphApi'
import Button from '~/components/ui/button/Button.vue'

defineProps<{
  columns: PlaybookDiagramColumn[]
  graphState: PlaybookGraphState
  graphMessage: string
  // Hình dạng dây của `infra.graph-*` chỉ có MỘT bản khai — bản của workstream graph.
  // Trang này là người DÙNG graph, không phải nguồn thứ hai của nó.
  graph: InfraGraph | null
}>()

const emit = defineEmits<{
  resolveImpact: []
  openGraph: []
}>()

const { t } = useI18n()

/** Bề rộng CỘT là thứ giữ ba hàng thẳng nhau — đổi ở đây, không phải ba chỗ. */
const COL = 'w-44 shrink-0 grow-0'

/** Màu chip theo lớp lệnh: đọc · ghi · phá huỷ. */
const VERB_CLASS: Record<string, string> = {
  read: 'border-info text-info',
  write: 'border-success text-success',
  destructive: 'border-destructive text-destructive',
}

/** Màu trạng thái bước. Bước bị cổng quyền chặn KHÔNG phải bước hỏng (hợp đồng §2). */
const STATE_CLASS: Record<string, string> = {
  ok: 'text-success',
  failed: 'text-destructive',
  blocked: 'text-warning',
  running: 'text-primary',
}
</script>
