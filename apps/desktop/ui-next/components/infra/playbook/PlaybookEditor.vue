<template>
  <!-- Trình soạn playbook (`/playbooks`). Bốn khối, đúng thứ tự người ta nghĩ:
       nhận dạng → nơi lưu → biến → bước.

       HỘP NÀY KHÔNG BIẾT LUẬT. Mọi phép kiểm, mọi giới hạn và lượt lưu nằm ở
       `usePlaybookEditor()`; ở đây chỉ có markup và bind. Lý do: hai bề mặt mở cùng hộp
       này (thanh công cụ và đầu màn chi tiết), nên trạng thái không được thuộc về SFC.

       LƯU ĐƯỢC BẢN CÒN THIẾU BƯỚC QUAY LUI. Sidecar cố ý cho lưu bản nháp dở và chỉ
       chặn ở `submit`. Vì vậy dải cảnh báo quay lui là CẢNH BÁO — nó không khoá nút Lưu,
       và nói rõ chỗ sẽ bị chặn là lúc gửi duyệt. -->
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="close">
      <div class="pbe" role="dialog" aria-modal="true">
        <header class="pbe-hd">
          <Icon name="edit" class="pbe-hd-ic" />
          <span class="pbe-ttl">
            {{ t(mode === 'edit' ? 'playbooks.editor.titleEdit' : 'playbooks.editor.titleNew') }}
          </span>
          <span class="pbe-gap" />
          <span class="pbe-id-preview" :title="t('playbooks.editor.idWhy')">
            {{ effectiveId }}.md
          </span>
        </header>

        <div class="pbe-body">
          <!-- ── Nhận dạng ───────────────────────────────────────────────── -->
          <div class="pbe-row">
            <label class="pbe-fld pbe-grow">
              <span class="pbe-lbl">{{ t('playbooks.editor.name') }}</span>
              <input
                v-model="form.name"
                class="pbe-inp"
                type="text"
                maxlength="160"
                autocomplete="off"
                :placeholder="t('playbooks.editor.namePlaceholder')"
              />
            </label>
            <label class="pbe-fld">
              <span class="pbe-lbl">{{ t('playbooks.editor.kind') }}</span>
              <AppSelect v-model="kind" :options="kindOptions" width="160px" />
            </label>
          </div>

          <label class="pbe-fld">
            <span class="pbe-lbl">{{ t('playbooks.editor.description') }}</span>
            <textarea
              v-model="form.description"
              class="pbe-inp pbe-area"
              rows="2"
              maxlength="1000"
              :placeholder="t('playbooks.editor.descriptionPlaceholder')"
            />
          </label>

          <!-- ── Nơi lưu ─────────────────────────────────────────────────── -->
          <!-- Khoá khi sửa: đổi tier là DI CHUYỂN file sang thư mục khác, không phải
               sửa nội dung. Muốn chuyển thì nhân bản sang nơi mới rồi xoá bản cũ. -->
          <div class="pbe-row">
            <label class="pbe-fld">
              <span class="pbe-lbl">{{ t('playbooks.editor.tier') }}</span>
              <AppSelect
                v-model="tier"
                :options="tierOptions"
                width="170px"
                :disabled="mode === 'edit'"
              />
            </label>
            <label v-if="form.tier === 'project'" class="pbe-fld pbe-grow">
              <span class="pbe-lbl">{{ t('playbooks.editor.project') }}</span>
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
          <section class="pbe-sec">
            <div class="pbe-sec-hd">
              <span class="pbe-sec-ttl">{{ t('playbooks.editor.variables') }}</span>
              <span class="pbe-sec-hint">{{ t('playbooks.editor.variablesWhy') }}</span>
              <span class="pbe-gap" />
              <button
                class="btn sm"
                type="button"
                :disabled="form.variables.length >= MAX_VARIABLES"
                @click="addVariable"
              >
                <Icon name="plus" class="pbe-ic" />
                {{ t('playbooks.editor.addVariable') }}
              </button>
            </div>

            <ul v-if="form.variables.length" class="pbe-vars">
              <li v-for="(v, i) in form.variables" :key="i" class="pbe-var">
                <input
                  v-model="v.name"
                  class="pbe-inp pbe-var-name"
                  type="text"
                  maxlength="64"
                  spellcheck="false"
                  :placeholder="t('playbooks.editor.varNamePlaceholder')"
                />
                <input
                  v-model="v.label"
                  class="pbe-inp pbe-grow"
                  type="text"
                  maxlength="160"
                  :placeholder="t('playbooks.editor.varLabelPlaceholder')"
                />
                <input
                  v-model="v.default"
                  class="pbe-inp pbe-var-def"
                  type="text"
                  maxlength="1024"
                  spellcheck="false"
                  :placeholder="t('playbooks.editor.varDefaultPlaceholder')"
                />
                <label class="pbe-req" :title="t('playbooks.editor.varRequiredWhy')">
                  <input v-model="v.required" type="checkbox" />
                  {{ t('playbooks.editor.varRequired') }}
                </label>
                <button
                  class="pbe-ibtn danger"
                  type="button"
                  :title="t('playbooks.editor.removeVariable')"
                  @click="removeVariable(i)"
                >
                  <Icon name="trash" class="pbe-ic" />
                </button>
              </li>
            </ul>
            <p v-else class="pbe-empty">{{ t('playbooks.editor.noVariables') }}</p>
          </section>

          <!-- ── Bước ────────────────────────────────────────────────────── -->
          <section class="pbe-sec">
            <div class="pbe-sec-hd">
              <span class="pbe-sec-ttl">{{ t('playbooks.editor.steps') }}</span>
              <span class="pbe-sec-hint">{{ t('playbooks.editor.stepsWhy') }}</span>
              <span class="pbe-gap" />
              <button
                v-for="v in EDITOR_VERBS"
                :key="v"
                class="btn sm"
                type="button"
                :disabled="form.steps.length >= MAX_STEPS"
                :title="t(`playbooks.editor.addStepWhy.${v}`)"
                @click="addStep(v)"
              >
                <Icon name="plus" class="pbe-ic" />
                {{ t(`playbooks.verb.${v}`) }}
              </button>
            </div>

            <!-- Cảnh báo, KHÔNG phải lỗi: bản nháp thiếu bước quay lui vẫn lưu được —
                 nó chỉ không gửi duyệt được. Câu chữ nói đúng chỗ sẽ bị chặn. -->
            <p v-if="missingRollback > 0" class="pbe-warn">
              <Icon name="alert" class="pbe-ic" />
              {{ t('playbooks.editor.missingRollback', { n: missingRollback }) }}
            </p>

            <ul class="pbe-steps">
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
          <ul v-if="blockingErrors.length" class="pbe-errs">
            <li v-for="(e, i) in blockingErrors" :key="i">{{ e }}</li>
          </ul>
          <ul v-if="issues.length" class="pbe-errs">
            <li v-for="(iss, i) in issues" :key="i">{{ issueText(iss) }}</li>
          </ul>
        </div>

        <footer class="pbe-ft">
          <button class="btn" type="button" :disabled="saving" @click="close">
            {{ t('common.cancel') }}
          </button>
          <button
            class="btn pri"
            type="button"
            :disabled="!canSave"
            :aria-busy="saving"
            @click="onSave"
          >
            {{ t('playbooks.editor.save') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
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

<style scoped>
.pbe {
  display: flex;
  flex-direction: column;
  width: min(860px, 94vw);
  max-height: 88vh;
  border: 1px solid var(--border);
  border-radius: var(--r-panel);
  background: var(--bgPanel);
  overflow: hidden;
}

.pbe-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 46px;
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 var(--border);
}

.pbe-hd-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
}

.pbe-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.pbe-gap {
  flex: 1;
}

.pbe-id-preview {
  font-family: var(--code); /* mono-ok: tên file thật trên đĩa */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.pbe-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow-y: auto;
}

.pbe-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.pbe-fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pbe-grow {
  flex: 1;
  min-width: 200px;
}

.pbe-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.pbe-inp {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.pbe-area {
  resize: vertical;
  min-height: 3rem;
}

.pbe-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.pbe-sec-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pbe-sec-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.pbe-sec-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.pbe-vars,
.pbe-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pbe-var {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pbe-var-name {
  width: 150px;
  font-family: var(--code); /* mono-ok: tên biến đi vào placeholder {{tên}} của argv */
}

.pbe-var-def {
  width: 160px;
  font-family: var(--code); /* mono-ok: giá trị nội suy thẳng vào argv */
}

.pbe-req {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
}

.pbe-empty {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.pbe-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--amber);
}

.pbe-errs {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--danger);
}

.pbe-ibtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.pbe-ibtn.danger:hover {
  background: var(--dangerBg);
  color: var(--danger);
}

.pbe-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex-shrink: 0;
}

.pbe-ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 var(--border);
}
</style>
