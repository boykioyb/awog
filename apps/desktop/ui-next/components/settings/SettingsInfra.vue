<template>
  <div>
    <SettingsPaneHeader :title="t('settingsInfra.heading')" />
    <p class="mt-0 mb-2.5 text-sm text-dim">{{ t('settingsInfra.intro') }}</p>

    <p
      v-if="error"
      class="mt-0 mb-2.5 rounded-md border border-destructive/40 px-2.5 py-1.5 text-sm text-destructive"
    >
      {{ errorText }}
    </p>

    <!-- ── Ma trận ──────────────────────────────────────────────────────────
         Bốn lớp × hai loại tài khoản. Bấm thẳng vào ô để đổi: một bảng mà phải
         mở modal cho từng ô thì không ai đọc được nó như một bảng nữa. -->
    <SettingsGroupLabel>{{ t('settingsInfra.matrix.heading') }}</SettingsGroupLabel>
    <p class="mt-0 mb-2 text-sm text-faint">{{ t('settingsInfra.matrix.hint') }}</p>

    <Table>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead class="text-xs text-dim">{{ t('settingsInfra.matrix.col.class') }}</TableHead>
          <TableHead v-for="kind in INFRA_KINDS" :key="kind" class="text-xs text-dim">
            {{ t(`settingsInfra.kind.${kind}`) }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="cls in INFRA_CLASSES" :key="cls" class="hover:bg-transparent">
          <TableCell>
            <div class="text-foreground">{{ t(`settingsInfra.class.${cls}`) }}</div>
            <div class="mt-0.5 text-xs text-faint">{{ t(`settingsInfra.classDesc.${cls}`) }}</div>
          </TableCell>
          <TableCell v-for="kind in INFRA_KINDS" :key="kind">
            <!-- Ba mức trong một segmented; chỉ ô ĐANG CHỌN mới nhuộm theo mức, vì tô cả
                 ba là biến bảng thành đèn giao thông và mất nghĩa. -->
            <ToggleGroup
              type="single"
              :spacing="1"
              class="rounded-lg bg-muted p-0.5"
              :model-value="matrix[cls][kind]"
              @update:model-value="onCellPick(cls, kind, $event)"
            >
              <ToggleGroupItem
                v-for="mode in INFRA_MODES"
                :key="mode"
                :value="mode"
                :title="t(`settingsInfra.modeDesc.${mode}`)"
                class="h-(--ctrl-h-xs) px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm"
                :class="MODE_ON_CLASS[mode]"
              >
                {{ t(`settingsInfra.mode.${mode}`) }}
              </ToggleGroupItem>
            </ToggleGroup>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <div class="mt-2 mb-3.5 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        :disabled="isDefaultMatrix || saving"
        variant="outline"
        size="sm"
        @click="onReset"
      >
        {{ t('settingsInfra.matrix.reset') }}
      </Button>
      <span v-if="isDefaultMatrix" class="text-sm text-faint">
        {{ t('settingsInfra.matrix.isDefault') }}
      </span>
    </div>

    <!-- ── Tài khoản production ─────────────────────────────────────────────
         Đây là nơi trả lời câu "vì sao chip PRODUCTION lại đỏ trên máy tôi". -->
    <SettingsGroupLabel>{{ t('settingsInfra.prod.heading') }}</SettingsGroupLabel>
    <p class="mt-0 mb-2 text-sm text-faint">{{ t('settingsInfra.prod.hint') }}</p>

    <div class="mt-2 mb-3.5 flex flex-wrap items-center gap-2">
      <Input
        v-model="newAccount"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        class="min-w-40 flex-1"
        :placeholder="t('settingsInfra.prod.placeholder')"
        @keydown.enter="onAddAccount"
      />
      <Button
        type="button"
        :disabled="!canAdd || saving"
        variant="default"
        size="sm"
        @click="onAddAccount"
      >
        <Icon name="plus" />
        {{ t('settingsInfra.prod.add') }}
      </Button>
    </div>

    <p v-if="accounts.length === 0" class="mt-0 mb-3.5 text-sm text-faint">
      {{ t('settingsInfra.prod.empty') }}
    </p>
    <ul v-else class="m-0 mb-3.5 flex list-none flex-col gap-1 p-0">
      <li
        v-for="id in accounts"
        :key="id"
        class="flex items-center gap-2.5 rounded-md border px-2 py-1"
      >
        <!-- mono-ok: account id, copy vào lệnh được -->
        <span class="min-w-0 flex-1 font-mono text-sm break-all">{{ id }}</span>
        <Button
          type="button"
          variant="link"
          size="xs"
          class="h-auto p-0 text-xs text-destructive"
          :disabled="saving"
          :title="t('settingsInfra.prod.remove')"
          @click="removeProdAccount(id)"
        >
          {{ t('settingsInfra.prod.remove') }}
        </Button>
      </li>
    </ul>

    <!-- ── Bypass ──────────────────────────────────────────────────────────
         Van xả cho lúc xử lý sự cố. Nó chỉ nâng `ask → auto`, KHÔNG gỡ `block`,
         và câu đó phải đứng ngay cạnh nút chứ không nằm trong tài liệu. -->
    <SettingsGroupLabel>{{ t('settingsInfra.bypass.heading') }}</SettingsGroupLabel>
    <p class="mt-0 mb-2 text-sm text-faint">{{ t('settingsInfra.bypass.hint') }}</p>

    <div class="mt-2 mb-3.5 flex flex-wrap items-center gap-2">
      <template v-if="bypassActive">
        <!-- Cửa nới quyền đang chạy phải nhìn thấy được — badge tông cảnh báo. -->
        <Badge variant="outline" class="border-warning/40 text-warning">
          {{ t('settingsInfra.bypass.left', { time: bypassLeftLabel }) }}
        </Badge>
        <Button
          type="button"
          :disabled="saving"
          variant="danger"
          size="sm"
          @click="setBypass(null)"
        >
          {{ t('settingsInfra.bypass.stop') }}
        </Button>
      </template>
      <template v-else>
        <Button
          v-for="m in BYPASS_MINUTES"
          :key="m"
          type="button"
          :disabled="saving"
          variant="outline"
          size="sm"
          @click="setBypass(m)"
        >
          {{ t('settingsInfra.bypass.for', { n: m }) }}
        </Button>
      </template>
    </div>

    <!-- ── Binary đã bảo lãnh ──────────────────────────────────────────────
         Chỉ GỠ được ở đây. Thêm thì phải đi qua chỗ lỗi thật sự xảy ra (banner
         ở /infra), nơi người dùng có đường dẫn trong tay. -->
    <SettingsGroupLabel>{{ t('settingsInfra.vouched.heading') }}</SettingsGroupLabel>
    <p class="mt-0 mb-2 text-sm text-faint">{{ t('settingsInfra.vouched.hint') }}</p>

    <p v-if="vouched.length === 0" class="mt-0 mb-3.5 text-sm text-faint">
      {{ t('settingsInfra.vouched.empty') }}
    </p>
    <ul v-else class="m-0 mb-3.5 flex list-none flex-col gap-1 p-0">
      <li
        v-for="p in vouched"
        :key="p"
        class="flex items-center gap-2.5 rounded-md border px-2 py-1"
      >
        <!-- mono-ok: đường dẫn binary, copy vào lệnh được -->
        <span class="min-w-0 flex-1 font-mono text-sm break-all">{{ p }}</span>
        <Button
          type="button"
          variant="link"
          size="xs"
          class="h-auto p-0 text-xs text-destructive"
          :disabled="saving"
          :title="t('settingsInfra.vouched.remove')"
          @click="unvouchBinary(p)"
        >
          {{ t('settingsInfra.vouched.remove') }}
        </Button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
// Settings → Hạ tầng: màn DUY NHẤT sửa được ma trận quyền hạ tầng.
// Toàn bộ state + RPC nằm ở `useInfraPolicySettings` (kèm lý do không dùng Pinia).
import { computed, onMounted, ref } from 'vue'
import {
  BYPASS_MINUTES,
  INFRA_CLASSES,
  INFRA_KINDS,
  INFRA_MODES,
  useInfraPolicySettings,
} from '~/composables/useInfraPolicySettings'
import type { InfraAccountKind } from '~/composables/useConfirm'
import type { InfraCommandClass, InfraMode } from '~/types'

const { t } = useI18n()

const {
  snapshot,
  matrix,
  isDefaultMatrix,
  saving,
  error,
  bypassActive,
  bypassLeftLabel,
  load,
  setCell,
  resetMatrix,
  addProdAccount,
  removeProdAccount,
  setBypass,
  unvouchBinary,
} = useInfraPolicySettings()

const newAccount = ref('')

const accounts = computed<string[]>(() => snapshot.value?.prodAccountIds ?? [])
const vouched = computed<string[]>(() => snapshot.value?.vouchedBinaryPaths ?? [])
const canAdd = computed<boolean>(
  () => newAccount.value.trim().length > 0 && !accounts.value.includes(newAccount.value.trim()),
)

/** Engine chết là một CA, không phải một lỗi lạ — nói bằng tiếng người. */
const errorText = computed<string>(() =>
  error.value === 'ENGINE_UNAVAILABLE' ? t('settingsInfra.noEngine') : error.value,
)

/**
 * Hạ `destructive/production` khỏi `block` là gỡ hàng rào mạnh nhất của cả thiết
 * kế, nên nó phải qua một câu hỏi. Mọi ô khác đổi thẳng: bắt xác nhận cho cả
 * bảng thì người dùng sẽ bấm Đồng ý theo phản xạ và câu hỏi mất nghĩa.
 */
async function onCell(
  cls: InfraCommandClass,
  kind: InfraAccountKind,
  mode: InfraMode,
): Promise<void> {
  const loosening =
    cls === 'destructive' && kind === 'production' && matrix.value[cls][kind] === 'block'
  if (loosening && !window.confirm(t('settingsInfra.matrix.confirmUnblock'))) return
  await setCell(cls, kind, mode)
}

// Màu chữ của mức đang chọn trong ô ma trận (chỉ ô đang bật mới nhuộm).
const MODE_ON_CLASS: Record<InfraMode, string> = {
  auto: 'data-[state=on]:text-foreground',
  ask: 'data-[state=on]:text-warning',
  block: 'data-[state=on]:text-destructive',
}

// ToggleGroup single phát rỗng khi bấm lại ô đang bật — ô ma trận luôn phải có mức.
function onCellPick(cls: InfraCommandClass, kind: InfraAccountKind, value: unknown): void {
  const mode = INFRA_MODES.find((m) => m === value)
  if (mode) void onCell(cls, kind, mode)
}

async function onReset(): Promise<void> {
  if (!window.confirm(t('settingsInfra.matrix.confirmReset'))) return
  await resetMatrix()
}

async function onAddAccount(): Promise<void> {
  if (!canAdd.value) return
  if (await addProdAccount(newAccount.value)) newAccount.value = ''
}

onMounted(() => void load())
</script>
