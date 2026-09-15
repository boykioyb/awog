<template>
  <!-- Form nhỏ ở cấp VIEW (task 3.6): tạo bucket, tạo "thư mục", tải lên, presign.
       Dùng khuôn overlay `.ovl.on` + Teleport của app để cùng một ngôn ngữ hình
       ảnh với mọi hộp thoại khác. -->
  <Teleport to="body">
    <div class="ovl on" @click.self="$emit('close')">
      <div class="ixf" role="dialog" aria-modal="true">
        <header class="ixf-hd">
          <Icon name="plus" />
          <span class="ixf-title">{{ t(form.label) }}</span>
          <button class="btn sm" type="button" @click="$emit('close')">
            <Icon name="x" />
          </button>
        </header>

        <!-- Hậu quả bằng lời người, TRƯỚC các ô nhập (ADR 0088 §5). -->
        <p class="ixf-consequence">{{ t(form.consequence) }}</p>

        <label v-for="f in form.fields" :key="f.key" class="ixf-field">
          <span class="ixf-lbl">
            {{ t(f.label) }}
            <span v-if="f.required" class="ixf-req">*</span>
          </span>
          <input
            v-model="values[f.key]"
            class="ixf-input"
            :placeholder="f.placeholder ?? ''"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <!-- Lớp phá huỷ: gõ lại đúng giá trị để mở khoá. Việc kiểm tra thật nằm ở
             sidecar (`__typeName`), đây chỉ là chỗ để người dùng bày tỏ ý định. -->
        <label v-if="typeNameField" class="ixf-field">
          <span class="ixf-lbl">
            {{ t('infra.explorer.confirm.typeName', { value: expected }) }}
          </span>
          <input v-model="typed" class="ixf-input" autocomplete="off" spellcheck="false" />
        </label>

        <footer class="ixf-ft">
          <span class="ixf-missing">{{ missingLabel }}</span>
          <button class="btn" type="button" @click="$emit('close')">
            {{ t('common.cancel') }}
          </button>
          <button class="btn pri" type="button" :disabled="!ready || busy" @click="submit">
            {{ t(form.label) }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// `__typeName` là TÊN KHOÁ TRÊN DÂY, không phải nhãn: sidecar đọc đúng khoá đó
// trong `runViewAction()`. Đổi tên ở đây mà quên bên kia là hộp xác nhận gõ-tên
// trở thành một ô nhập không ai kiểm.
import { computed, reactive, ref } from 'vue'
import type { InfraFormDescriptor } from '~/composables/useInfraResourcesApi'

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

<style scoped>
.ixf {
  width: min(420px, calc(100vw - 32px));
  margin-top: 4vh;
  padding: 14px 16px 12px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ixf-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textMuted);
}

.ixf-title {
  flex: 1;
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.ixf-consequence {
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ixf-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ixf-req {
  color: var(--red);
  margin-left: 3px;
}

.ixf-input {
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}

.ixf-input:focus {
  border-color: var(--accentBorder);
}

.ixf-ft {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.ixf-missing {
  flex: 1;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
