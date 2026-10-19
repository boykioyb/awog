<template>
  <!-- Một hàng bước của trình soạn. Tách riêng vì hàng này là phần lặp nặng nhất của
       form (5 ô + 4 nút), và vì `PlaybookEditor.vue` đã chạm trần ~250 dòng.

       THUẦN TRÌNH BÀY: nó không biết gì về lược đồ, về luật quay lui, hay về lượt lưu.
       Bước đi vào qua `v-model` và mỗi lần sửa GHI LẠI CẢ BƯỚC lên cha — không mutate
       object của `form.steps` tại chỗ (`vue/no-mutating-props` cấm, và cấm đúng). -->
  <li class="flex flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5">
    <div class="flex items-center gap-1.5">
      <span class="min-w-5 text-sm text-dim tabular-nums">{{ index + 1 }}</span>

      <AppSelect v-model="verb" :options="verbOptions" width="116px" />
      <AppSelect v-model="tool" :options="toolOptions" width="116px" />

      <!-- mono-ok: id đi vào `actor: playbook:<id>#<bước>` của nhật ký -->
      <Input
        v-model="id"
        type="text"
        maxlength="64"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('playbooks.editor.step.idPlaceholder')"
        :title="t('playbooks.editor.step.idWhy')"
        class="w-32 font-mono"
      />

      <span class="flex-1" />

      <!-- Bốn nút icon-trần: nhãn chữ trên một hàng lặp 20 lần là 20 lần đọc lại cùng
           một chữ. `title` mang nghĩa, và thứ tự lên/xuống là luật (xem `moveStep`). -->
      <Button
        variant="ghost"
        size="iconSm"
        class="text-dim disabled:opacity-40"
        :disabled="index === 0"
        :title="t('playbooks.editor.step.up')"
        :aria-label="t('playbooks.editor.step.up')"
        @click="emit('move', -1)"
      >
        <!-- Sprite không có mũi tên LÊN — xoay mũi tên xuống. -->
        <Icon name="chev" class="rotate-180" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-dim disabled:opacity-40"
        :disabled="isLast"
        :title="t('playbooks.editor.step.down')"
        :aria-label="t('playbooks.editor.step.down')"
        @click="emit('move', 1)"
      >
        <Icon name="chev" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-dim hover:bg-destructive/10 hover:text-destructive"
        :title="t('playbooks.editor.step.remove')"
        :aria-label="t('playbooks.editor.step.remove')"
        @click="emit('remove')"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <Input
      v-model="title"
      type="text"
      maxlength="200"
      :placeholder="t('playbooks.editor.step.titlePlaceholder')"
    />

    <!-- MỖI DÒNG MỘT ĐỐI SỐ. Không phải ô lệnh shell: `args` là mảng theo hợp đồng, và
         một ô tự tách theo khoảng trắng sẽ bẻ đôi `--query 'Reservations[].Instances[]'`.
         Nhãn nói thẳng điều đó thay vì để người dùng đoán rồi gõ sai. -->
    <label class="flex flex-col gap-1">
      <span class="flex items-baseline gap-1.5 text-xs text-dim">
        {{ t('playbooks.editor.step.args') }}
        <span class="text-faint">{{ t('playbooks.editor.step.argsWhy') }}</span>
      </span>
      <!-- mono-ok: argv và ghi chú kèm lệnh, copy được ra terminal -->
      <Textarea
        :model-value="argsText"
        class="min-h-14 resize-y font-mono"
        rows="3"
        spellcheck="false"
        :placeholder="argsPlaceholder"
        @update:model-value="(v: string | number) => (argsText = String(v))"
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class="flex items-baseline gap-1.5 text-xs text-dim">
        {{ t('playbooks.editor.step.note') }}
        <span class="text-faint">{{ t('playbooks.editor.step.noteWhy') }}</span>
      </span>
      <Textarea
        :model-value="note"
        class="min-h-14 resize-y font-mono"
        rows="2"
        maxlength="2000"
        :placeholder="t('playbooks.editor.step.notePlaceholder')"
        @update:model-value="(v: string | number) => (note = String(v))"
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
import Input from '~/components/ui/input/Input.vue'

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
