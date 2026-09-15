<template>
  <div class="ape-field">
    <label class="ape-label">
      {{ label ?? t('infra.editor.region') }}
      <span v-if="required" class="ape-req" aria-hidden="true">*</span>
    </label>
    <AppSelect v-if="!manual" v-model="selected" :options="options" width="100%" />
    <input
      v-else
      v-model.trim="model"
      class="ape-input"
      spellcheck="false"
      :placeholder="t('infra.editor.regionPh')"
    />
    <div class="ape-hint ape-region-hint">
      <span v-if="hint" :class="hintTone === 'warn' ? 'ape-region-warn' : 'ape-region-detected'">
        {{ hint }}
      </span>
      <button v-if="manual" type="button" class="ape-region-link" @click="manual = false">
        {{ t('infra.editor.region.useList') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Ô chọn Region cho form sửa profile (2026-09-14: "Region auto detect được không
// hoặc phải hiển thị dropdown chọn"). Ba tính chất:
//
//   1. Mặc định là DROPDOWN danh sách region chuẩn — không phải ô trống bắt gõ
//      tay (`utils/aws-regions.ts`).
//   2. Vẫn còn ô nhập tay cho region chưa có trong danh sách: lựa chọn "Khác…"
//      ở cuối menu, hoặc tự mở ô nhập khi giá trị đang có KHÔNG nằm trong danh
//      sách (profile cũ, GovCloud/ISO lạ) — mở dropdown ở ca đó là làm mất giá trị
//      ở lần Lưu kế tiếp.
//   3. `hint` do cha truyền xuống, là câu "vừa tự dò được từ đâu" — cha biết
//      nguồn (profile / ngữ cảnh đang ghim / profile `default`), component thì không.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { AWS_REGIONS, isKnownRegion } from '~/utils/aws-regions'

withDefaults(
  defineProps<{
    label?: string | undefined
    hint?: string | undefined
    /**
     * `warn` cho câu cảnh báo (ô đang trống ở một profile CHƯA có region trên
     * đĩa — xem `AwsProfileEditor.vue`), mặc định là câu "tự dò từ đâu".
     */
    hintTone?: 'info' | 'warn'
    /**
     * Ô này đang là điều kiện chặn Lưu (xem `canSave()` ở AwsProfileEditor.vue)
     * ⇒ nhãn hiện dấu `*`. Component không tự suy ra được: cùng một ô Region,
     * lượt TẠO MỚI thì bắt buộc còn lượt SỬA thì để trống là "giữ nguyên" (trừ
     * profile `static` chưa có region trên đĩa) — cha mới biết đang ở lượt nào.
     */
    required?: boolean
  }>(),
  { label: undefined, hint: undefined, hintTone: 'info', required: false },
)

const model = defineModel<string>({ required: true })

const { t } = useI18n()

/** Giá trị đặc biệt của menu: đổi sang ô nhập tay, không phải một region thật. */
const CUSTOM = '\u0000custom'

// '' KHÔNG phải "region lạ cần gõ tay" — nó là "chưa đặt", một lựa chọn có sẵn
// trong danh sách (`regionUnset`). Coi nó là gõ-tay thì mở form cho một profile
// chưa có region sẽ ra một ô TRỐNG TRƠN thay vì danh sách: người dùng không có gì
// để bấm, và lần Lưu kế tiếp ghi ra profile không region mà không một dòng cảnh
// báo. Ô gõ tay chỉ dành cho region CÓ giá trị mà không nằm trong danh sách
// (GovCloud/ISO lạ, profile cũ).
const manual = ref(model.value.trim() !== '' && !isKnownRegion(model.value))

// Giá trị đến từ BÊN NGOÀI (prefill khi mở modal, đổi profile đang sửa) mà không
// nằm trong danh sách ⇒ mở ô nhập tay. Không có nhánh này thì sửa một profile
// GovCloud là dropdown hiện trống trơn và lần Lưu sau ghi mất region.
watch(model, (v) => {
  if (v.trim() !== '' && !isKnownRegion(v)) manual.value = true
})

const selected = computed({
  get: () => (manual.value ? '' : model.value),
  set: (v: string) => {
    if (v === CUSTOM) {
      manual.value = true
      return
    }
    model.value = v
  },
})

const options = computed<AppSelectOption[]>(() => {
  const out: AppSelectOption[] = [{ value: '', label: t('infra.editor.regionUnset') }]
  const current = model.value.trim()
  if (current !== '' && !isKnownRegion(current)) {
    out.push({ value: current, label: t('infra.editor.regionCurrent', { region: current }) })
  }
  for (const region of AWS_REGIONS) out.push({ value: region, label: region })
  out.push({ value: CUSTOM, label: t('infra.editor.region.typeManually') })
  return out
})
</script>

<style scoped>
/* Bốn class dưới đây lặp lại vocabulary của các form con khác trong cùng thư mục
   (`AwsProfileEditorSsoFields.vue`…): style scoped của component cha KHÔNG với
   tới phần tử bên trong component con, nên mỗi mảnh form phải tự khai. */
.ape-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ape-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
/* Dấu `*` bắt buộc — cùng vocabulary với `.sse-req` (SshEditor) / `.vpe-req`
   (VpnEditor), nhưng khai lại vì style scoped không với tới component khác. */
.ape-req {
  color: var(--danger);
  font-weight: 700;
}
.ape-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.ape-input:focus {
  border-color: var(--accent);
}
.ape-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ape-region-hint {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.ape-region-detected {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ape-region-warn {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--amber);
}
.ape-region-link {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
  cursor: pointer;
}
.ape-region-link:hover {
  text-decoration: underline;
}
</style>
