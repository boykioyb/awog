<template>
  <!-- Một hàng bước của trình soạn. Tách riêng vì hàng này là phần lặp nặng nhất của
       form (5 ô + 4 nút), và vì `PlaybookEditor.vue` đã chạm trần ~250 dòng.

       THUẦN TRÌNH BÀY: nó không biết gì về lược đồ, về luật quay lui, hay về lượt lưu.
       Bước đi vào qua `v-model` và mỗi lần sửa GHI LẠI CẢ BƯỚC lên cha — không mutate
       object của `form.steps` tại chỗ (`vue/no-mutating-props` cấm, và cấm đúng). -->
  <li class="pbe-step">
    <div class="pbe-step-hd">
      <span class="pbe-no">{{ index + 1 }}</span>

      <AppSelect v-model="verb" :options="verbOptions" width="116px" />
      <AppSelect v-model="tool" :options="toolOptions" width="116px" />

      <input
        v-model="id"
        class="pbe-inp pbe-id"
        type="text"
        maxlength="64"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('playbooks.editor.step.idPlaceholder')"
        :title="t('playbooks.editor.step.idWhy')"
      />

      <span class="pbe-step-gap" />

      <!-- Bốn nút icon-trần: nhãn chữ trên một hàng lặp 20 lần là 20 lần đọc lại cùng
           một chữ. `title` mang nghĩa, và thứ tự lên/xuống là luật (xem `moveStep`). -->
      <button
        class="pbe-ibtn"
        type="button"
        :disabled="index === 0"
        :title="t('playbooks.editor.step.up')"
        @click="emit('move', -1)"
      >
        <Icon name="chev" class="pbe-ic pbe-up" />
      </button>
      <button
        class="pbe-ibtn"
        type="button"
        :disabled="isLast"
        :title="t('playbooks.editor.step.down')"
        @click="emit('move', 1)"
      >
        <Icon name="chev" class="pbe-ic" />
      </button>
      <button
        class="pbe-ibtn danger"
        type="button"
        :title="t('playbooks.editor.step.remove')"
        @click="emit('remove')"
      >
        <Icon name="trash" class="pbe-ic" />
      </button>
    </div>

    <input
      v-model="title"
      class="pbe-inp"
      type="text"
      maxlength="200"
      :placeholder="t('playbooks.editor.step.titlePlaceholder')"
    />

    <!-- MỖI DÒNG MỘT ĐỐI SỐ. Không phải ô lệnh shell: `args` là mảng theo hợp đồng, và
         một ô tự tách theo khoảng trắng sẽ bẻ đôi `--query 'Reservations[].Instances[]'`.
         Nhãn nói thẳng điều đó thay vì để người dùng đoán rồi gõ sai. -->
    <label class="pbe-sub">
      <span class="pbe-sub-lbl">
        {{ t('playbooks.editor.step.args') }}
        <span class="pbe-hint">{{ t('playbooks.editor.step.argsWhy') }}</span>
      </span>
      <textarea
        v-model="argsText"
        class="pbe-inp pbe-area"
        rows="3"
        spellcheck="false"
        :placeholder="argsPlaceholder"
      />
    </label>

    <label class="pbe-sub">
      <span class="pbe-sub-lbl">
        {{ t('playbooks.editor.step.note') }}
        <span class="pbe-hint">{{ t('playbooks.editor.step.noteWhy') }}</span>
      </span>
      <textarea
        v-model="note"
        class="pbe-inp pbe-area"
        rows="2"
        maxlength="2000"
        :placeholder="t('playbooks.editor.step.notePlaceholder')"
      />
    </label>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { EDITOR_TOOLS, EDITOR_VERBS } from '~/composables/usePlaybookEditor'
import type { EditorStep } from '~/composables/usePlaybookEditor'
import type { PlaybookVerb } from '~/composables/usePlaybooksApi'
import type { InfraTool } from '~/types'

defineProps<{ index: number; isLast: boolean }>()

const emit = defineEmits<{ move: [delta: -1 | 1]; remove: [] }>()

/**
 * Bước đi qua `v-model`, KHÔNG qua prop thường. `vue/no-mutating-props` (error trong
 * repo này) cấm ghi vào `props.step.verb`, và cấm đúng: hai bên sẽ sửa chung một object
 * mà không ai khai ra. Với model thì mỗi lần sửa GHI LẠI CẢ BƯỚC — cha nhận một object
 * mới vào `form.steps[i]`, nên thay đổi luôn đi qua một đường duy nhất.
 */
const model = defineModel<EditorStep>({ required: true })

/** Ô nhập ghi thẳng một trường; đọc thì lấy từ model. Năm ô, một khuôn. */
function field<K extends keyof EditorStep>(key: K) {
  return computed<EditorStep[K]>({
    get: () => model.value[key],
    set: (v) => {
      model.value = { ...model.value, [key]: v }
    },
  })
}

const id = field('id')
const title = field('title')
const argsText = field('argsText')
const note = field('note')

/**
 * `AppSelect` nói chuyện bằng `string`, còn `verb`/`tool` là union hẹp. Hai computed này
 * là chỗ thu hẹp lại — bỏ qua thì kiểu nới ra `string` và một giá trị lạ đi thẳng tới
 * lược đồ zod của sidecar.
 */
const verb = computed<string>({
  get: () => model.value.verb,
  set: (v) => {
    if ((EDITOR_VERBS as readonly string[]).includes(v)) {
      model.value = { ...model.value, verb: v as PlaybookVerb }
    }
  },
})

const tool = computed<string>({
  get: () => model.value.tool,
  set: (v) => {
    if ((EDITOR_TOOLS as readonly string[]).includes(v)) {
      model.value = { ...model.value, tool: v as InfraTool }
    }
  },
})

const { t } = useI18n()

const verbOptions = computed<AppSelectOption[]>(() =>
  EDITOR_VERBS.map((v) => ({ value: v, label: t(`playbooks.verb.${v}`) })),
)

const toolOptions = computed<AppSelectOption[]>(() =>
  EDITOR_TOOLS.map((v) => ({ value: v, label: v })),
)

/** Ví dụ đổi theo công cụ đang chọn — một ví dụ `aws` dưới ô `kubectl` là chỉ dẫn sai. */
const argsPlaceholder = computed(() => t(`playbooks.editor.step.argsEg.${model.value.tool}`))
</script>

<style scoped>
.pbe-step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}

.pbe-step-hd {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pbe-no {
  min-width: 20px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}

.pbe-step-gap {
  flex: 1;
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

.pbe-id {
  width: 128px;
  font-family: var(--code); /* mono-ok: id đi vào `actor: playbook:<id>#<bước>` của nhật ký */
}

.pbe-area {
  resize: vertical;
  min-height: 3.5rem;
  font-family: var(--code); /* mono-ok: argv và ghi chú kèm lệnh, copy được ra terminal */
}

.pbe-sub {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pbe-sub-lbl {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.pbe-hint {
  color: var(--textFaint);
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

.pbe-ibtn:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}

.pbe-ibtn.danger:hover:not(:disabled) {
  background: var(--dangerBg);
  color: var(--danger);
}

.pbe-ibtn:disabled {
  opacity: 0.4;
  cursor: default;
}

.pbe-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.pbe-up {
  transform: rotate(180deg);
}
</style>
