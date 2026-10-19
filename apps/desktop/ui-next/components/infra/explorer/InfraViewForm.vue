<template>
  <!-- Form nhỏ ở cấp VIEW (task 3.6): tạo bucket, tạo "thư mục", tải lên, presign.
       Dùng `Dialog` của app để cùng một ngôn ngữ hình ảnh với mọi hộp thoại khác;
       Esc / bấm nền / nút ✕ (DialogContent tự vẽ) đều phát `close`. -->
  <Dialog :open="true" @update:open="(v: boolean) => !v && $emit('close')">
    <DialogContent class="flex w-[calc(100vw-2rem)] max-w-105 flex-col gap-2.5 px-4 pt-3.5 pb-3">
      <DialogHeader class="flex-row items-center gap-2 pr-8 text-muted-foreground">
        <Icon name="plus" />
        <DialogTitle class="flex-1 text-base font-semibold text-foreground">
          {{ t(form.label) }}
        </DialogTitle>
      </DialogHeader>

      <!-- Hậu quả bằng lời người, TRƯỚC các ô nhập (ADR 0088 §5). -->
      <DialogDescription class="text-sm">{{ t(form.consequence) }}</DialogDescription>

      <label v-for="f in form.fields" :key="f.key" class="flex flex-col gap-1">
        <span class="text-xs text-dim">
          {{ t(f.label) }}
          <span v-if="f.required" class="ml-0.5 text-destructive">*</span>
        </span>
        <Input
          v-model="values[f.key]"
          :placeholder="f.placeholder ?? ''"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <!-- Lớp phá huỷ: gõ lại đúng giá trị để mở khoá. Việc kiểm tra thật nằm ở
           sidecar (`__typeName`), đây chỉ là chỗ để người dùng bày tỏ ý định. -->
      <label v-if="typeNameField" class="flex flex-col gap-1">
        <span class="text-xs text-dim">
          {{ t('infra.explorer.confirm.typeName', { value: expected }) }}
        </span>
        <Input v-model="typed" autocomplete="off" spellcheck="false" />
      </label>

      <DialogFooter class="items-center gap-2 pt-1 sm:justify-start">
        <span class="flex-1 text-xs text-warning">{{ missingLabel }}</span>
        <Button type="button" variant="outline" @click="$emit('close')">
          {{ t('common.cancel') }}
        </Button>
        <Button type="button" :disabled="!ready || busy" variant="default" @click="submit">
          {{ t(form.label) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// `__typeName` là TÊN KHOÁ TRÊN DÂY, không phải nhãn: sidecar đọc đúng khoá đó
// trong `runViewAction()`. Đổi tên ở đây mà quên bên kia là hộp xác nhận gõ-tên
// trở thành một ô nhập không ai kiểm.
import { computed, reactive, ref } from 'vue'
import type { InfraFormDescriptor } from '~/composables/useInfraResourcesApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ form: InfraFormDescriptor; busy: boolean }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', values: Record<string, string>): void
}>()

const { t } = useI18n()
const values = reactive<Record<string, string>>({})
const typed = ref('')

const typeNameField = computed(() => props.form.typeNameField)
const expected = computed(() => (typeNameField.value ? (values[typeNameField.value] ?? '') : ''))

/** Thiếu ô bắt buộc thì nút Tắt — để người dùng thấy TRƯỚC khi bấm, không phải sau. */
const missing = computed(
  () => props.form.fields.filter((f) => f.required && !(values[f.key] ?? '').trim()).length,
)
const ready = computed(() => missing.value === 0)
const missingLabel = computed(() =>
  missing.value === 0 ? '' : t('infra.explorer.form.missing', { n: missing.value }),
)

function submit(): void {
  if (!ready.value) return
  const out: Record<string, string> = { ...values }
  // Chỉ gửi khi form thật sự có lớp gõ-tên: một `__typeName` rỗng gửi kèm form
  // thường sẽ khiến sidecar so chuỗi rỗng với giá trị thật rồi từ chối oan.
  if (typeNameField.value) out['__typeName'] = typed.value
  emit('submit', out)
}
</script>
