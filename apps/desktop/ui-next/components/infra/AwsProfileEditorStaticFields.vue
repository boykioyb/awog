<template>
  <!-- mono-ok (các ô font-mono dưới đây): access key / secret / session token là giá
       trị copy-paste thẳng vào ~/.aws/credentials hoặc terminal (export AWS_*). -->
  <div class="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
    <div class="flex items-center gap-2">
      <Icon name="shield" class="size-3.5 text-primary" />
      <span class="text-sm font-semibold text-foreground">
        {{ t('infra.editor.static.title') }}
      </span>
    </div>
    <p class="-mt-1 text-xs text-dim">{{ t('infra.editor.static.hint') }}</p>
    <!-- Đã nạp khoá thật từ ~/.aws/credentials vào form (2026-09-14): nói thẳng ra
         để người dùng không tưởng 3 ô đang rỗng là "khoá đã mất". -->
    <p v-if="secretsLoaded" class="-mt-1 text-xs text-dim">{{ t('infra.editor.static.loaded') }}</p>

    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        <!-- Dấu `*` CHỈ ở lượt tạo mới: sửa profile có sẵn thì ô trống là "giữ
             nguyên khoá trên đĩa" (S2a) nên không bắt buộc. -->
        {{ t('infra.editor.static.accessKeyId') }}
        <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
      </Label>
      <Input
        v-model.trim="model.accessKeyId"
        spellcheck="false"
        autocomplete="off"
        :placeholder="
          isExisting
            ? t('infra.editor.static.accessKeyIdPhKeep')
            : t('infra.editor.static.accessKeyIdPh')
        "
        class="font-mono"
      />
      <div v-if="accessKeyFormatWarn" class="text-xs text-warning">
        {{ t('infra.editor.static.accessKeyFormatWarn') }}
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.static.secretAccessKey') }}
        <span v-if="!isExisting" class="font-semibold text-destructive" aria-hidden="true">*</span>
      </Label>
      <div class="flex items-center gap-1.5">
        <Input
          v-model.trim="model.secretAccessKey"
          :type="showSecret ? 'text' : 'password'"
          spellcheck="false"
          autocomplete="off"
          :placeholder="
            isExisting ? t('infra.editor.static.secretPhKeep') : t('infra.editor.static.secretPh')
          "
          class="min-w-0 flex-1 font-mono"
        />
        <Button
          type="button"
          :title="showSecret ? t('infra.editor.hideSecret') : t('infra.editor.showSecret')"
          variant="outline"
          size="iconMd"
          @click="showSecret = !showSecret"
        >
          <Icon :name="showSecret ? 'eye-off' : 'eye'" class="size-3.5" />
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.static.sessionToken') }}
        <span class="font-normal text-dim">{{ t('infra.editor.optional') }}</span>
      </Label>
      <div class="flex items-center gap-1.5">
        <Input
          v-model.trim="model.sessionToken"
          :type="showToken ? 'text' : 'password'"
          spellcheck="false"
          autocomplete="off"
          :placeholder="
            isExisting
              ? t('infra.editor.static.sessionTokenPhKeep')
              : t('infra.editor.static.sessionTokenPh')
          "
          class="min-w-0 flex-1 font-mono"
        />
        <Button
          type="button"
          :title="showToken ? t('infra.editor.hideSecret') : t('infra.editor.showSecret')"
          variant="outline"
          size="iconMd"
          @click="showToken = !showToken"
        >
          <Icon :name="showToken ? 'eye-off' : 'eye'" class="size-3.5" />
        </Button>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3.5">
    <AwsRegionField
      v-model="model.region"
      :hint="regionHint"
      :hint-tone="regionHintTone"
      :required="regionRequired"
    />
    <div class="flex flex-col gap-1.5">
      <Label class="gap-1 text-xs font-semibold text-foreground">
        {{ t('infra.editor.output') }}
      </Label>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
