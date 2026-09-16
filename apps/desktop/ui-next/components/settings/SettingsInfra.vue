<template>
  <div>
    <SettingsPaneHeader :title="t('settingsInfra.heading')" />
    <p class="siwhy">{{ t('settingsInfra.intro') }}</p>

    <p v-if="error" class="sierr">{{ errorText }}</p>

    <!-- ── Ma trận ──────────────────────────────────────────────────────────
         Bốn lớp × hai loại tài khoản. Bấm thẳng vào ô để đổi: một bảng mà phải
         mở modal cho từng ô thì không ai đọc được nó như một bảng nữa. -->
    <div class="sech">{{ t('settingsInfra.matrix.heading') }}</div>
    <p class="sihint">{{ t('settingsInfra.matrix.hint') }}</p>

    <table class="kt simx">
      <thead>
        <tr>
          <th>{{ t('settingsInfra.matrix.col.class') }}</th>
          <th v-for="kind in INFRA_KINDS" :key="kind">
            {{ t(`settingsInfra.kind.${kind}`) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cls in INFRA_CLASSES" :key="cls">
          <td>
            <div class="simx-cls">{{ t(`settingsInfra.class.${cls}`) }}</div>
            <div class="simx-clsd">{{ t(`settingsInfra.classDesc.${cls}`) }}</div>
          </td>
          <td v-for="kind in INFRA_KINDS" :key="kind">
            <div class="seg simx-seg">
              <span
                v-for="mode in INFRA_MODES"
                :key="mode"
                :class="{ on: matrix[cls][kind] === mode, [`m-${mode}`]: true }"
                role="button"
                :aria-pressed="matrix[cls][kind] === mode"
                :title="t(`settingsInfra.modeDesc.${mode}`)"
                @click="onCell(cls, kind, mode)"
              >
                {{ t(`settingsInfra.mode.${mode}`) }}
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="sirow">
      <button class="btn sm" type="button" :disabled="isDefaultMatrix || saving" @click="onReset">
        {{ t('settingsInfra.matrix.reset') }}
      </button>
      <span v-if="isDefaultMatrix" class="sihint">{{ t('settingsInfra.matrix.isDefault') }}</span>
    </div>

    <!-- ── Tài khoản production ─────────────────────────────────────────────
         Đây là nơi trả lời câu "vì sao chip PRODUCTION lại đỏ trên máy tôi". -->
    <div class="sech">{{ t('settingsInfra.prod.heading') }}</div>
    <p class="sihint">{{ t('settingsInfra.prod.hint') }}</p>

    <div class="sirow">
      <input
        v-model="newAccount"
        class="siinp"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('settingsInfra.prod.placeholder')"
        @keydown.enter="onAddAccount"
      />
      <button class="btn sm pri" type="button" :disabled="!canAdd || saving" @click="onAddAccount">
        <Icon name="plus" />
        {{ t('settingsInfra.prod.add') }}
      </button>
    </div>

    <p v-if="accounts.length === 0" class="siempty">{{ t('settingsInfra.prod.empty') }}</p>
    <ul v-else class="silist">
      <li v-for="id in accounts" :key="id">
        <span class="siacc">{{ id }}</span>
        <button
          class="silink"
          type="button"
          :disabled="saving"
          :title="t('settingsInfra.prod.remove')"
          @click="removeProdAccount(id)"
        >
          {{ t('settingsInfra.prod.remove') }}
        </button>
      </li>
    </ul>

    <!-- ── Bypass ──────────────────────────────────────────────────────────
         Van xả cho lúc xử lý sự cố. Nó chỉ nâng `ask → auto`, KHÔNG gỡ `block`,
         và câu đó phải đứng ngay cạnh nút chứ không nằm trong tài liệu. -->
    <div class="sech">{{ t('settingsInfra.bypass.heading') }}</div>
    <p class="sihint">{{ t('settingsInfra.bypass.hint') }}</p>

    <div class="sirow">
      <template v-if="bypassActive">
        <span class="chip warn">
          {{ t('settingsInfra.bypass.left', { time: bypassLeftLabel }) }}
        </span>
        <button class="btn sm danger" type="button" :disabled="saving" @click="setBypass(null)">
          {{ t('settingsInfra.bypass.stop') }}
        </button>
      </template>
      <template v-else>
        <button
          v-for="m in BYPASS_MINUTES"
          :key="m"
          class="btn sm"
          type="button"
          :disabled="saving"
          @click="setBypass(m)"
        >
          {{ t('settingsInfra.bypass.for', { n: m }) }}
        </button>
      </template>
    </div>

    <!-- ── Binary đã bảo lãnh ──────────────────────────────────────────────
         Chỉ GỠ được ở đây. Thêm thì phải đi qua chỗ lỗi thật sự xảy ra (banner
         ở /infra), nơi người dùng có đường dẫn trong tay. -->
    <div class="sech">{{ t('settingsInfra.vouched.heading') }}</div>
    <p class="sihint">{{ t('settingsInfra.vouched.hint') }}</p>

    <p v-if="vouched.length === 0" class="siempty">{{ t('settingsInfra.vouched.empty') }}</p>
    <ul v-else class="silist">
      <li v-for="p in vouched" :key="p">
        <span class="sipath">{{ p }}</span>
        <button
          class="silink"
          type="button"
          :disabled="saving"
          :title="t('settingsInfra.vouched.remove')"
          @click="unvouchBinary(p)"
        >
          {{ t('settingsInfra.vouched.remove') }}
        </button>
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
  type InfraAccountKind,
  type InfraCommandClass,
  type InfraMode,
} from '~/composables/useInfraPolicySettings'

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

<style scoped>
.siwhy,
.sihint {
  margin: 0 0 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}

.sihint {
  margin: -2px 0 8px;
  color: var(--textFaint);
}

.sierr {
  margin: 0 0 10px;
  padding: 6px 10px;
  border: 1px solid var(--dangerBorder);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
}

.simx {
  width: 100%;
}

.simx-cls {
  color: var(--text);
}

.simx-clsd {
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

/* Ba mức nằm trong một `.seg` để dùng đúng hình bấm của app; chỉ ô ĐANG CHỌN mới
   nhuộm theo mức, vì tô cả ba là biến bảng thành đèn giao thông và mất nghĩa. */
.simx-seg {
  width: max-content;
}

.simx-seg span.on.m-ask {
  color: var(--amber);
}

.simx-seg span.on.m-block {
  color: var(--danger);
}

.sirow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0 14px;
}

/* `.chip` toàn cục không có biến thể tông — `.warn` chỉ được định nghĩa trong
   scope của thẻ duyệt. Khai lại ở đây thay vì nâng lên toàn cục: một cửa nới
   quyền đang chạy phải nhìn thấy được, và đó là chỗ DUY NHẤT màn này cần tông. */
.sirow .chip.warn {
  border-color: var(--amberBorder);
  color: var(--amber);
}

.siinp {
  flex: 1 1 220px;
  min-width: 160px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.siempty {
  margin: 0 0 14px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.silist {
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.silist li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}

.siacc,
.sipath {
  flex: 1;
  min-width: 0;
  font-family: var(--code); /* mono-ok: account id + đường dẫn, copy vào lệnh được */
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  word-break: break-all;
}

.silink {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  white-space: nowrap;
}

.silink:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
