<template>
  <!-- Màn chi tiết của `/playbooks` (việc 5.5). Thứ tự cố ý:
       tên → tóm tắt (bước · dịch vụ · quay lui) → biến → hành động →
       SƠ ĐỒ BA HÀNG → danh sách bước → kết quả chạy.
       Người đọc phải nắm được "đụng vào gì, ai chết theo, hỏng thì lui sao" TRƯỚC khi
       nhìn thấy một dòng lệnh nào. -->
  <div class="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto px-4 pt-3 pb-4">
    <div
      v-if="loading"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8.5 text-center text-dim"
    >
      <Icon name="refresh" class="size-5 animate-spin" />
      <p class="text-base text-muted-foreground" role="status" aria-busy="true">
        {{ t('playbooks.detail.loading') }}
      </p>
    </div>

    <div
      v-else-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8.5 text-center text-dim"
    >
      <Icon name="alert" class="size-5" />
      <p class="text-base text-muted-foreground">{{ t('playbooks.detail.error.title') }}</p>
      <p class="max-w-115 text-xs leading-(--lh-sm) text-dim">{{ error }}</p>
      <p class="max-w-115 text-xs leading-(--lh-sm) text-dim">
        {{ t('playbooks.detail.error.hint') }}
      </p>
      <Button type="button" variant="outline" size="sm" @click="emit('retry')">
        {{ t('playbooks.list.retry') }}
      </Button>
    </div>

    <div
      v-else-if="!playbook"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8.5 text-center text-dim"
    >
      <Icon name="book" class="size-5" />
      <p class="text-base text-muted-foreground">{{ t('playbooks.detail.none.title') }}</p>
      <p class="max-w-115 text-xs leading-(--lh-sm) text-dim">
        {{ t('playbooks.detail.none.hint') }}
      </p>
    </div>

    <template v-else>
      <header class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-semibold text-foreground">{{ playbook.name }}</h2>
        <!-- Chip trạng thái là của LƯỢT CHẠY đang xem, không phải của playbook:
             playbook không có trạng thái riêng (hợp đồng §4). -->
        <Badge
          v-if="view.run"
          variant="outline"
          class="rounded-sm font-medium text-muted-foreground"
        >
          {{ t(`playbooks.status.${view.run.status}`) }}
        </Badge>
        <!-- Bản dựng sẵn: chỉ đọc, sửa/xoá đều bị sidecar từ chối — nói trước. -->
        <span
          v-if="view.source"
          class="text-xs"
          :class="view.source === 'builtin' ? 'text-lavender' : 'text-dim'"
          :title="view.source === 'builtin' ? t('playbooks.source.builtinWhy') : ''"
        >
          {{ t(`playbooks.source.${view.source}`) }}
        </span>
        <span class="text-xs text-dim">
          {{
            t('playbooks.meta.tier', {
              kind: t(`playbooks.kind.${playbook.kind}`),
              tier: t(`playbooks.tier.${playbook.tier}`),
            })
          }}
        </span>

        <!-- Đẩy ba nút ra mép phải. -->
        <span class="flex-1" />

        <!-- Sửa · Nhân bản · Xoá. Icon-trần với `title`, theo luật hàng nút của
             `*Detail.vue` (.claude/rules/nuxt-vue.md §UI patterns) — không trộn
             nút-có-chữ vào cùng hàng.

             Bản dựng sẵn chỉ được NHÂN BẢN: nó nằm trong mã, `-save`/`-delete` đều
             từ chối nó, nên hiện nút Sửa ở đó là mời người dùng đâm vào một lỗi. -->
        <Button
          v-if="writable"
          variant="ghost"
          size="iconMd"
          class="text-dim disabled:opacity-40"
          type="button"
          :disabled="view.busy"
          :title="t('playbooks.action.edit')"
          :aria-label="t('playbooks.action.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-dim disabled:opacity-40"
          type="button"
          :disabled="view.busy"
          :title="t('playbooks.action.duplicate')"
          :aria-label="t('playbooks.action.duplicate')"
          @click="emit('duplicate')"
        >
          <Icon name="copy" />
        </Button>
        <Button
          v-if="writable"
          variant="ghost"
          size="iconMd"
          class="text-dim hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          type="button"
          :disabled="view.busy"
          :title="t('playbooks.action.delete')"
          :aria-label="t('playbooks.action.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" />
        </Button>
      </header>

      <p v-if="playbook.description" class="text-sm leading-(--lh-prose) text-muted-foreground">
        {{ playbook.description }}
      </p>

      <p class="flex flex-wrap items-center gap-1 text-xs leading-(--lh-sm) text-dim">
        {{
          t('playbooks.meta.summary', {
            steps: playbook.steps.length,
            services: view.touchedServices.length,
          })
        }}
        <span v-if="view.rollback.total" :class="{ 'text-warning': view.rollback.missing > 0 }">
          · {{ rollbackLabel }}
        </span>
        <span class="ml-1.5 text-faint">
          {{ t('playbooks.meta.updated', { at: playbook.updatedAt }) }}
        </span>
      </p>

      <!-- File HỎNG: nói ngay chỗ nào, vì đây cũng là lý do nút gửi duyệt bị tắt. -->
      <p
        v-if="view.issues?.length"
        class="flex items-center gap-1 text-xs leading-(--lh-sm) text-warning"
      >
        <Icon name="alert" class="size-3" />
        {{ t('playbooks.detail.issues', { n: view.issues.length }) }}
      </p>

      <!-- Biến: điền trước khi kiểm tra hoặc chạy -->
      <div v-if="view.variables.length" class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold text-muted-foreground">
            {{ t('playbooks.variables.title') }}
          </span>
          <span v-if="view.requiredMissing.length" class="text-xs text-warning">
            {{ t('playbooks.variables.required') }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <label v-for="v in view.variables" :key="v.name" class="flex min-w-40 flex-col gap-1">
            <span class="text-xs text-dim">
              {{ v.label || v.name }}
              <span v-if="v.required" class="text-warning">*</span>
            </span>
            <Input
              type="text"
              :model-value="view.values[v.name] ?? ''"
              :placeholder="v.default ?? ''"
              @update:model-value="onVar(v.name, $event)"
            />
          </label>
        </div>
      </div>

      <!-- Hành động. Nút bị TẮT luôn kèm lý do ngay dưới (luật 3 + luật 4). -->
      <div class="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          :disabled="view.busy || view.requiredMissing.length > 0"
          variant="outline"
          size="sm"
          @click="emit('preflight')"
        >
          <Icon name="inspect" />
          {{ t('playbooks.action.preflight') }}
        </Button>

        <Button
          type="button"
          :disabled="view.busy || !view.canSubmit || view.requiredMissing.length > 0"
          :title="
            view.canSubmit ? '' : t('playbooks.action.submitBlocked', { n: view.rollback.missing })
          "
          variant="outline"
          size="sm"
          @click="emit('submit')"
        >
          <Icon name="send" />
          {{ t('playbooks.action.submit') }}
        </Button>

        <!-- Duyệt chỉ có MỘT chiều: hợp đồng không có RPC từ chối, nên UI không mời
             một việc không làm được. -->
        <Button
          v-if="view.canApprove"
          type="button"
          :disabled="view.busy"
          variant="default"
          size="sm"
          @click="emit('approve')"
        >
          <Icon name="check" />
          {{ t('playbooks.action.approve') }}
        </Button>

        <Button
          type="button"
          :disabled="view.busy || !view.canRun"
          variant="outline"
          size="sm"
          @click="emit('run')"
        >
          <Icon name="play" />
          {{ view.busy ? t('playbooks.action.working') : t('playbooks.action.run') }}
        </Button>

        <Button
          type="button"
          :disabled="view.busy || !view.canRollback"
          variant="outline"
          size="sm"
          @click="emit('rollback')"
        >
          <Icon name="revert" />
          {{ t('playbooks.action.rollback') }}
        </Button>

        <!-- Chia sẻ playbook (6.7). Nút chỉ MỞ hộp xuất: bản xuất do sidecar dựng
             từ chính file playbook trên đĩa, nên client không có bản thứ hai để
             lệch. Mẫu "để duyệt" BỊ BUỘC che — sidecar cưỡng chế, không phải một
             công tắc người dùng tắt được. -->
        <Button
          type="button"
          :disabled="view.busy"
          variant="outline"
          size="sm"
          @click="emit('share')"
        >
          <Icon name="download" />
          {{ t('playbooks.action.share') }}
        </Button>

        <!-- Mẫu thứ ba — "báo cáo sau khi chạy" — chỉ có nghĩa khi ĐÃ có lượt chạy:
             nó kể lại việc đã xảy ra, không phải việc sẽ làm. -->
        <Button
          v-if="view.run"
          type="button"
          :disabled="view.busy"
          variant="outline"
          size="sm"
          @click="emit('shareRun')"
        >
          <Icon name="book" />
          {{ t('playbooks.action.shareRun') }}
        </Button>
      </div>

      <p
        v-if="view.rollback.missing > 0"
        class="flex items-center gap-1 text-xs leading-(--lh-sm) text-warning"
      >
        <Icon name="alert" class="size-3" />
        {{ t('playbooks.action.submitBlocked', { n: view.rollback.missing }) }}
      </p>
      <!-- Bước `do` nào còn thiếu cặp: sidecar đã ghép cặp THEO CHỈ SỐ, UI chỉ đọc
           lại danh sách id nó trả (`summary.missingRollback`) chứ không tự đoán. -->
      <p
        v-if="view.rollback.missingIds.length"
        class="flex items-center gap-1 text-xs leading-(--lh-sm) text-warning"
      >
        {{ t('playbooks.action.submitMissing', { ids: view.rollback.missingIds.join(', ') }) }}
      </p>
      <p
        v-if="view.requiredMissing.length > 0"
        class="flex items-center gap-1 text-xs leading-(--lh-sm) text-warning"
      >
        <Icon name="alert" class="size-3" />
        {{ t('playbooks.variables.required') }}
      </p>

      <PlaybookDiagram
        :columns="view.columns"
        :graph-state="view.graphState"
        :graph-message="view.graphMessage"
        :graph="view.graph"
        @resolve-impact="emit('resolveImpact')"
        @open-graph="emit('openGraph')"
      />

      <PlaybookSteps :columns="view.columns" :mode="view.mode" />

      <PlaybookRunPanel
        :columns="view.columns"
        :preflight="view.preflight"
        :run="view.run"
        :runs="view.runs"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import PlaybookDiagram from '~/components/infra/playbook/PlaybookDiagram.vue'
import PlaybookRunPanel from '~/components/infra/playbook/PlaybookRunPanel.vue'
import PlaybookSteps from '~/components/infra/playbook/PlaybookSteps.vue'
import { useI18n } from '~/composables/useI18n'
import { computed } from 'vue'
import type { PlaybookDetailView } from '~/composables/usePlaybooksManager'
import type { Playbook } from '~/composables/usePlaybooksApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  playbook: Playbook | null
  view: PlaybookDetailView
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  retry: []
  preflight: []
  submit: []
  approve: []
  run: []
  rollback: []
  share: []
  shareRun: []
  resolveImpact: []
  openGraph: []
  setVariable: [name: string, value: string]
  edit: []
  duplicate: []
  delete: []
}>()

const { t } = useI18n()

/**
 * Ghi được hay không. `view.source` VẮNG MẶT khi chưa mở bản nào, và `undefined` ở đây
 * phải là "không ghi được" — mặc định ngược lại sẽ loé hai nút ghi trong đúng một nhịp
 * trước khi `source` về.
 */
const writable = computed(() => props.view.source !== undefined && props.view.source !== 'builtin')

/** Dòng "quay lui": có thì nói phủ được bao nhiêu bước ghi, thiếu thì nói thẳng là thiếu. */
const rollbackLabel = computed(() =>
  props.view.rollback.missing > 0
    ? t('playbooks.meta.rollback.none', { n: props.view.rollback.missing })
    : t('playbooks.meta.rollback.yes', {
        covered: props.view.rollback.covered,
        total: props.view.rollback.total,
      }),
)

/** `v-model` trên prop là mutate prop — emit giá trị lên manager thay vì sửa tại chỗ. */
function onVar(name: string, v: string): void {
  emit('setVariable', name, v)
}
</script>
