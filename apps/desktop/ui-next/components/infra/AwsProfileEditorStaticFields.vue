<template>
  <div class="ape-secret">
    <div class="ape-secret-head">
      <Icon
        name="shield"
        style="width: var(--icon-sm); height: var(--icon-sm); color: var(--accent)"
      />
      <span class="ape-secret-title">{{ t('infra.editor.static.title') }}</span>
    </div>
    <p class="ape-secret-hint">{{ t('infra.editor.static.hint') }}</p>
    <!-- Đã nạp khoá thật từ ~/.aws/credentials vào form (2026-09-14): nói thẳng ra
         để người dùng không tưởng 3 ô đang rỗng là "khoá đã mất". -->
    <p v-if="secretsLoaded" class="ape-secret-hint">{{ t('infra.editor.static.loaded') }}</p>

    <div class="ape-field">
      <label class="ape-label">
        <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
             nguyên khoá trên đĩa" (S2a) nên không bắt buộc. -->
        {{ t('infra.editor.static.accessKeyId') }}
        <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
      </label>
      <input
        v-model.trim="model.accessKeyId"
        class="ape-input mono"
        spellcheck="false"
        autocomplete="off"
        :placeholder="
          isExisting
            ? t('infra.editor.static.accessKeyIdPhKeep')
            : t('infra.editor.static.accessKeyIdPh')
        "
      />
      <div v-if="accessKeyFormatWarn" class="ape-warn">
        {{ t('infra.editor.static.accessKeyFormatWarn') }}
      </div>
    </div>

    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.static.secretAccessKey') }}
        <span v-if="!isExisting" class="ape-req" aria-hidden="true">*</span>
      </label>
      <div class="ape-secret-row">
        <input
          v-model.trim="model.secretAccessKey"
          :type="showSecret ? 'text' : 'password'"
          class="ape-input mono"
          spellcheck="false"
          autocomplete="off"
          :placeholder="
            isExisting ? t('infra.editor.static.secretPhKeep') : t('infra.editor.static.secretPh')
          "
        />
        <button
          type="button"
          class="iconbtn"
          :title="showSecret ? t('infra.editor.hideSecret') : t('infra.editor.showSecret')"
          @click="showSecret = !showSecret"
        >
          <Icon
            :name="showSecret ? 'eye-off' : 'eye'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
      </div>
    </div>

    <div class="ape-field">
      <label class="ape-label">
        {{ t('infra.editor.static.sessionToken') }}
        <span class="ape-optional">{{ t('infra.editor.optional') }}</span>
      </label>
      <div class="ape-secret-row">
        <input
          v-model.trim="model.sessionToken"
          :type="showToken ? 'text' : 'password'"
          class="ape-input mono"
          spellcheck="false"
          autocomplete="off"
          :placeholder="
            isExisting
              ? t('infra.editor.static.sessionTokenPhKeep')
              : t('infra.editor.static.sessionTokenPh')
          "
        />
        <button
          type="button"
          class="iconbtn"
          :title="showToken ? t('infra.editor.hideSecret') : t('infra.editor.showSecret')"
          @click="showToken = !showToken"
        >
          <Icon
            :name="showToken ? 'eye-off' : 'eye'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
      </div>
    </div>
  </div>

  <div class="ape-row">
    <AwsRegionField
      v-model="model.region"
      :hint="regionHint"
      :hint-tone="regionHintTone"
      :required="regionRequired"
    />
    <div class="ape-field">
      <label class="ape-label">{{ t('infra.editor.output') }}</label>
      <AppSelect v-model="model.output" :options="outputOptions" width="100%" />
    </div>
  </div>

  <!-- Chỉ khi TẠO MỚI: lúc sửa một profile đã có khoá thì "Chưa có access key?"
       là nhiễu, còn lúc tạo mới đây là câu hỏi đầu tiên người dùng gặp
       (docs/features/aws-profile-manager.md §"Lấy credential ở đâu"). -->
  <AwsProfileCredentialHelp v-if="!isExisting" context="static" />
</template>

<script setup lang="ts">
// Form con của AwsProfileEditor.vue cho kind === 'static' (A3, docs/features/
// aws-profile-manager.md §"Form theo kiểu"). Ba khoá secret đi thẳng vào
// ~/.aws/credentials trong đúng một lần lưu — component KHÔNG tự gọi RPC, chỉ
// giữ state form qua v-model; cha (AwsProfileEditor.vue) là nơi gọi
// profileSave() và xoá sạch state secret NGAY sau khi lưu thành công (luật cứng
// #2 — ô nhập type="password" + xoá sau lưu).
import { computed, ref } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import AwsRegionField from '~/components/infra/AwsRegionField.vue'
import type { StaticFormState } from '~/utils/aws-profile-form'

withDefaults(
  defineProps<{
    // true khi đang SỬA một profile có sẵn — đổi placeholder của 3 ô secret sang
    // "để trống = giữ khoá hiện tại" thay vì gợi ý nhập mới.
    isExisting: boolean
    // Ba ô secret đang chứa GIÁ TRỊ THẬT đọc từ `~/.aws/credentials`
    // (`infra.profile-secrets`) chứ không phải ô rỗng chờ người dùng gõ.
    secretsLoaded?: boolean
    // Câu "region này vừa tự dò được từ đâu" — cha dựng, xem `detectRegion()`.
    regionHint?: string | undefined
    /**
     * `warn` khi câu hint là CẢNH BÁO (ô trống ở profile chưa có region trên
     * đĩa) chứ không phải câu giải thích nguồn gốc giá trị.
     */
    regionHintTone?: 'info' | 'warn'
    /**
     * Region của profile `static` đang chặn Lưu (lượt TẠO MỚI, hoặc lượt SỬA
     * một profile mà TRÊN ĐĨA chưa có region — xem `regionMissing()` ở
     * AwsProfileEditor.vue). Khác hai ô khoá: region bắt buộc ở cả hai lượt.
     */
    regionRequired?: boolean
  }>(),
  {
    secretsLoaded: false,
    regionHint: undefined,
    regionHintTone: 'info',
    regionRequired: false,
  },
)

const model = defineModel<StaticFormState>({ required: true })

const { t } = useI18n()

const showSecret = ref(false)
const showToken = ref(false)

// AWS access key id thường (không phải luôn luôn) khớp AKIA/ASIA + 16 ký tự —
// lệch thì CẢNH BÁO chứ không chặn (AWS có định dạng khác cho vài loại khoá,
// docs/features/aws-profile-manager.md §"Form theo kiểu profile").
const ACCESS_KEY_RE = /^(AKIA|ASIA)[A-Z0-9]{16}$/
const accessKeyFormatWarn = computed(() => {
  const v = model.value.accessKeyId.trim()
  return v.length > 0 && !ACCESS_KEY_RE.test(v)
})

const outputOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('infra.editor.outputUnset') },
  { value: 'json', label: 'json' },
  { value: 'yaml', label: 'yaml' },
  { value: 'yaml-stream', label: 'yaml-stream' },
  { value: 'text', label: 'text' },
  { value: 'table', label: 'table' },
])
</script>

<style scoped>
.ape-secret {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
}
.ape-secret-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ape-secret-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.ape-secret-hint {
  margin: -4px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
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
.ape-optional {
  font-weight: 400;
  color: var(--textDim);
}
/* Dấu `*` bắt buộc — cùng vocabulary với `.sse-req` (SshEditor). */
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
.ape-input.mono {
  /* mono-ok: access key / secret / session token là giá trị copy-paste thẳng
     vào ~/.aws/credentials hoặc terminal (export AWS_*). */
  font-family: var(--code);
}
.ape-input:focus {
  border-color: var(--accent);
}
.ape-secret-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ape-secret-row .ape-input {
  flex: 1;
  min-width: 0;
}
.ape-warn {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}
.ape-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
</style>
