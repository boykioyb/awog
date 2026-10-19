<template>
  <!-- Trình soạn playbook (`/playbooks`). Bốn khối, đúng thứ tự người ta nghĩ:
       nhận dạng → nơi lưu → biến → bước.

       HỘP NÀY KHÔNG BIẾT LUẬT. Mọi phép kiểm, mọi giới hạn và lượt lưu nằm ở
       `usePlaybookEditor()`; ở đây chỉ có markup và bind. Lý do: hai bề mặt mở cùng hộp
       này (thanh công cụ và đầu màn chi tiết), nên trạng thái không được thuộc về SFC.

       LƯU ĐƯỢC BẢN CÒN THIẾU BƯỚC QUAY LUI. Sidecar cố ý cho lưu bản nháp dở và chỉ
       chặn ở `submit`. Vì vậy dải cảnh báo quay lui là CẢNH BÁO — nó không khoá nút Lưu,
       và nói rõ chỗ sẽ bị chặn là lúc gửi duyệt.

       Dialog shadcn (reka): bấm nền là đóng như hộp cũ; Esc bị chặn (`escape-key-down`
       preventDefault) để giữ đúng hành vi cũ — hộp soạn dài không được mất bản nháp
       vì một phím. `[role=dialog][data-state=open]` đã có trong OVERLAYS. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && close()">
    <DialogContent
      class="flex max-h-[88vh] w-[94vw] max-w-215 flex-col gap-0 overflow-hidden bg-card p-0 sm:rounded-2xl"
      @escape-key-down="(e: KeyboardEvent) => e.preventDefault()"
    >
      <!-- Hairline dưới thanh cao cố định = inset box-shadow, không border (border ăn
           1px của chiều cao và đẩy con căn giữa vào nửa pixel). -->
      <DialogHeader
        class="h-11.5 shrink-0 flex-row items-center gap-2 px-3.5 pr-12 shadow-[inset_0_-1px_0_var(--border)]"
      >
        <Icon name="edit" class="size-3.5 text-dim" />
        <DialogTitle class="text-base font-normal text-foreground">
          {{ t(mode === 'edit' ? 'playbooks.editor.titleEdit' : 'playbooks.editor.titleNew') }}
        </DialogTitle>
        <span class="flex-1" />
        <!-- mono-ok: tên file thật trên đĩa -->
        <span class="font-mono text-xs text-faint" :title="t('playbooks.editor.idWhy')">
          {{ effectiveId }}.md
        </span>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-y-auto p-3.5">
        <!-- ── Nhận dạng ───────────────────────────────────────────────── -->
        <div class="flex flex-wrap items-end gap-2.5">
          <label class="flex min-w-50 flex-1 flex-col gap-1">
            <span class="text-xs text-dim">{{ t('playbooks.editor.name') }}</span>
            <Input
              v-model="form.name"
              type="text"
              maxlength="160"
              autocomplete="off"
              :placeholder="t('playbooks.editor.namePlaceholder')"
            />
          </label>
          <label class="flex min-w-0 flex-col gap-1">
            <span class="text-xs text-dim">{{ t('playbooks.editor.kind') }}</span>
            <AppSelect v-model="kind" :options="kindOptions" width="160px" />
          </label>
        </div>

        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-xs text-dim">{{ t('playbooks.editor.description') }}</span>
          <Textarea
            :model-value="form.description"
            class="min-h-12 resize-y"
            rows="2"
            maxlength="1000"
            :placeholder="t('playbooks.editor.descriptionPlaceholder')"
            @update:model-value="(v: string | number) => (form.description = String(v))"
          />
        </label>

        <!-- ── Nơi lưu ─────────────────────────────────────────────────── -->
        <!-- Khoá khi sửa: đổi tier là DI CHUYỂN file sang thư mục khác, không phải
             sửa nội dung. Muốn chuyển thì nhân bản sang nơi mới rồi xoá bản cũ. -->
        <div class="flex flex-wrap items-end gap-2.5">
          <label class="flex min-w-0 flex-col gap-1">
            <span class="text-xs text-dim">{{ t('playbooks.editor.tier') }}</span>
            <AppSelect
              v-model="tier"
              :options="tierOptions"
              width="170px"
              :disabled="mode === 'edit'"
            />
          </label>
          <label v-if="form.tier === 'project'" class="flex min-w-50 flex-1 flex-col gap-1">
            <span class="text-xs text-dim">{{ t('playbooks.editor.project') }}</span>
            <AppSelect
              v-model="form.projectId"
              :options="projectOptions"
              width="100%"
              :disabled="mode === 'edit'"
              :placeholder="t('playbooks.editor.projectPlaceholder')"
            />
          </label>
        </div>

        <!-- ── Biến ────────────────────────────────────────────────────── -->
        <section class="flex flex-col gap-2 border-t pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-base text-foreground">{{ t('playbooks.editor.variables') }}</span>
            <span class="text-xs text-faint">{{ t('playbooks.editor.variablesWhy') }}</span>
            <span class="flex-1" />
            <Button
              type="button"
              :disabled="form.variables.length >= MAX_VARIABLES"
              variant="outline"
              size="sm"
              @click="addVariable"
            >
              <Icon name="plus" />
              {{ t('playbooks.editor.addVariable') }}
            </Button>
          </div>

          <ul v-if="form.variables.length" class="m-0 flex list-none flex-col gap-2 p-0">
            <li
              v-for="(v, i) in form.variables"
              :key="i"
              class="flex flex-wrap items-center gap-1.5"
            >
              <!-- mono-ok: tên biến đi vào placeholder {{tên}} của argv -->
              <Input
                v-model="v.name"
                type="text"
                maxlength="64"
                spellcheck="false"
                :placeholder="t('playbooks.editor.varNamePlaceholder')"
                class="w-37.5 font-mono"
              />
              <Input
                v-model="v.label"
                type="text"
                maxlength="160"
                :placeholder="t('playbooks.editor.varLabelPlaceholder')"
                class="w-auto min-w-50 flex-1"
              />
              <!-- mono-ok: giá trị nội suy thẳng vào argv -->
              <Input
                v-model="v.default"
                type="text"
                maxlength="1024"
                spellcheck="false"
                :placeholder="t('playbooks.editor.varDefaultPlaceholder')"
                class="w-40 font-mono"
              />
              <Label
                class="cursor-pointer gap-1 text-xs font-normal whitespace-nowrap text-dim"
                :title="t('playbooks.editor.varRequiredWhy')"
              >
                <Checkbox
                  :model-value="v.required"
                  @update:model-value="v.required = $event === true"
                />
                {{ t('playbooks.editor.varRequired') }}
              </Label>
              <Button
                variant="ghost"
                size="iconSm"
                class="text-dim hover:bg-destructive/10 hover:text-destructive"
                :title="t('playbooks.editor.removeVariable')"
                :aria-label="t('playbooks.editor.removeVariable')"
                @click="removeVariable(i)"
              >
                <Icon name="trash" />
              </Button>
            </li>
          </ul>
          <p v-else class="text-xs leading-(--lh-sm) text-faint">
            {{ t('playbooks.editor.noVariables') }}
          </p>
        </section>

        <!-- ── Bước ────────────────────────────────────────────────────── -->
        <section class="flex flex-col gap-2 border-t pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-base text-foreground">{{ t('playbooks.editor.steps') }}</span>
            <span class="text-xs text-faint">{{ t('playbooks.editor.stepsWhy') }}</span>
            <span class="flex-1" />
            <Button
              v-for="v in EDITOR_VERBS"
              :key="v"
              type="button"
              :disabled="form.steps.length >= MAX_STEPS"
              :title="t(`playbooks.editor.addStepWhy.${v}`)"
              variant="outline"
              size="sm"
              @click="addStep(v)"
            >
              <Icon name="plus" />
              {{ t(`playbooks.verb.${v}`) }}
            </Button>
          </div>

          <!-- Cảnh báo, KHÔNG phải lỗi: bản nháp thiếu bước quay lui vẫn lưu được —
               nó chỉ không gửi duyệt được. Câu chữ nói đúng chỗ sẽ bị chặn. -->
          <p
            v-if="missingRollback > 0"
            class="flex items-start gap-1.5 text-xs leading-(--lh-sm) text-warning"
          >
            <Icon name="alert" class="size-3 shrink-0" />
            {{ t('playbooks.editor.missingRollback', { n: missingRollback }) }}
          </p>

          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <PlaybookEditorStep
              v-for="(s, i) in form.steps"
              :key="i"
              v-model="form.steps[i]!"
              :index="i"
              :is-last="i === form.steps.length - 1"
              @move="(d) => moveStep(i, d)"
              @remove="removeStep(i)"
            />
          </ul>
        </section>

        <!-- Lỗi của chính hộp này (chặn Lưu) rồi tới lỗi sidecar trả về sau một lượt
             lưu hỏng — hai nguồn khác nhau nên không gộp thành một danh sách. -->
        <ul
          v-if="blockingErrors.length"
          class="m-0 flex list-disc flex-col gap-0.5 pl-4.5 text-xs leading-(--lh-sm) text-destructive"
        >
          <li v-for="(e, i) in blockingErrors" :key="i">{{ e }}</li>
        </ul>
        <ul
          v-if="issues.length"
          class="m-0 flex list-disc flex-col gap-0.5 pl-4.5 text-xs leading-(--lh-sm) text-destructive"
        >
          <li v-for="(iss, i) in issues" :key="i">{{ issueText(iss) }}</li>
        </ul>
      </div>

      <DialogFooter class="shrink-0 gap-2 px-3.5 py-2.5 shadow-[inset_0_1px_0_var(--border)]">
        <Button type="button" :disabled="saving" variant="outline" @click="close">
          {{ t('common.cancel') }}
        </Button>
        <Button
          type="button"
          :disabled="!canSave"
          :aria-busy="saving"
          variant="default"
          @click="onSave"
        >
          {{ t('playbooks.editor.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import {
  EDITOR_KINDS,
  EDITOR_VERBS,
  MAX_STEPS,
  MAX_VARIABLES,
  usePlaybookEditor,
} from '~/composables/usePlaybookEditor'
import { useProjectsStore } from '~/stores/projects'
import type { EditorTarget } from '~/composables/usePlaybookEditor'
import type { PlaybookIssue, PlaybookKind, PlaybookTier } from '~/composables/usePlaybooksApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const emit = defineEmits<{ saved: [target: EditorTarget] }>()

const { t } = useI18n()
const projects = useProjectsStore()

const {
  open,
  mode,
  form,
  saving,
  issues,
  close,
  addStep,
  removeStep,
  moveStep,
  addVariable,
  removeVariable,
  effectiveId,
  missingRollback,
  blockingErrors,
  canSave,
  save,
} = usePlaybookEditor()

/** Thu hẹp `string` của `AppSelect` về union — cùng lý do với `verb`/`tool` ở hàng bước. */
const kind = computed<string>({
  get: () => form.kind,
  set: (v) => {
    if ((EDITOR_KINDS as readonly string[]).includes(v)) form.kind = v as PlaybookKind
  },
})

const tier = computed<string>({
  get: () => form.tier,
  set: (v) => {
    if (v === 'global' || v === 'project') form.tier = v as PlaybookTier
  },
})

const kindOptions = computed<AppSelectOption[]>(() =>
  EDITOR_KINDS.map((k) => ({ value: k, label: t(`playbooks.kind.${k}`) })),
)

const tierOptions = computed<AppSelectOption[]>(() => [
  { value: 'global', label: t('playbooks.tier.global') },
  { value: 'project', label: t('playbooks.tier.project') },
])

/**
 * Trang này liệt kê playbook của MỌI project đã đăng ký và không có bộ chọn project ở
 * thanh công cụ — nên lưu vào tier project phải hỏi project nào. Khác màn Bảng điều
 * khiển, nơi project suy được từ phiên đang mở; ở đây không có phiên nào.
 */
const projectOptions = computed<AppSelectOption[]>(() =>
  projects.projects.map((p) => ({ value: p.id, label: p.name })),
)

/** `code` là khoá dịch được; `message` là chi tiết kỹ thuật của zod (đường dẫn trường). */
function issueText(iss: PlaybookIssue): string {
  const head = t(iss.code)
  return iss.message ? `${head} — ${iss.message}` : head
}

async function onSave(): Promise<void> {
  const target = await save()
  if (target) emit('saved', target)
}
</script>
