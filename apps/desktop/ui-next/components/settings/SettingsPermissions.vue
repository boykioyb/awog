<template>
  <div>
    <SettingsPaneHeader
      :title="t('settingsPermissions.heading')"
      :subtitle="t('settingsPermissions.subtitle')"
    />

    <div v-if="!available" class="mb-2.5 rounded-md border px-2.5 py-2 text-sm text-dim">
      {{ t('settingsPermissions.unavailable') }}
    </div>

    <template v-else>
      <div
        v-if="lastError"
        class="mb-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
      >
        {{ lastError }}
      </div>

      <!-- Tệp luật không đọc được: mọi luật trong đó — kể cả luật từ chối — đang
           vô hiệu, nên nó phải hiện lên đầu trang chứ không nằm im trong log. -->
      <div
        v-for="err in fileErrors"
        :key="err.file"
        class="mb-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm text-destructive"
      >
        <div class="font-semibold">{{ t('settingsPermissions.corrupt.title') }}</div>
        <div>
          {{ t('settingsPermissions.corrupt.body', { file: err.file, reason: err.reason }) }}
        </div>
      </div>

      <!-- ── Gợi ý từ lịch sử ─────────────────────────────────────────────── -->
      <div class="mt-5 mb-2 flex items-center justify-between gap-2">
        <div data-set-label class="text-xs font-medium text-muted-foreground">
          {{ t('settingsPermissions.suggest.heading') }}
        </div>
        <Button :disabled="scanning" variant="outline" size="sm" @click="scan">
          <Icon name="scan" />
          {{
            scanning
              ? t('settingsPermissions.suggest.scanning')
              : t('settingsPermissions.suggest.scan')
          }}
        </Button>
      </div>
      <p class="mt-0 mb-2 text-sm text-dim">{{ t('settingsPermissions.suggest.desc') }}</p>

      <div v-if="scanReport" class="mb-2 text-xs text-faint">
        {{
          t('settingsPermissions.suggest.report', {
            sessions: scanReport.sessions,
            kb: Math.round(scanReport.bytes / 1024),
          })
        }}
        <span v-if="scanReport.truncated">{{ t('settingsPermissions.suggest.truncated') }}</span>
      </div>

      <div v-for="s in suggestions" :key="s.id" class="flex items-center gap-2 border-t py-2">
        <div class="min-w-0 flex-1">
          <!-- mono-ok: chuỗi luật là cú pháp máy đọc, copy thẳng được vào file luật JSON -->
          <code class="font-mono text-sm wrap-anywhere text-foreground select-text">
            {{ s.rule }}
          </code>
          <div class="mt-0.5 text-xs text-faint">
            {{ t('settingsPermissions.suggest.count', { n: s.count }) }}
            <span v-if="s.projects.length > 0">· {{ projectNames(s) }}</span>
          </div>
        </div>
        <AppSelect
          :model-value="targetOf(s)"
          :options="targetOptions(s)"
          width="190px"
          @update:model-value="targets[s.id] = $event"
        />
        <Button :disabled="busyKey === s.id" variant="outline" size="sm" @click="onAccept(s)">
          {{ t('settingsPermissions.suggest.add') }}
        </Button>
      </div>
      <div v-if="scanReport && suggestions.length === 0" class="px-0.5 py-2.5 text-sm text-faint">
        {{ t('settingsPermissions.suggest.none') }}
      </div>
      <p class="mt-2 mb-2 text-sm text-faint">{{ t('settingsPermissions.suggest.safety') }}</p>

      <!-- ── Chặn một tool ────────────────────────────────────────────────── -->
      <div class="mt-5 mb-2 flex items-center justify-between gap-2">
        <div data-set-label class="text-xs font-medium text-muted-foreground">
          {{ t('settingsPermissions.deny.heading') }}
        </div>
      </div>
      <p class="mt-0 mb-2 text-sm text-dim">{{ t('settingsPermissions.deny.desc') }}</p>
      <div class="mb-3 flex items-center gap-2">
        <!-- mono-ok: luật tool là cú pháp máy đọc -->
        <Input
          v-model="denyRule"
          :placeholder="t('settingsPermissions.deny.placeholder')"
          class="min-w-0 flex-1 font-mono"
          @keyup.enter="onAddDeny"
        />
        <AppSelect v-model="denyTarget" :options="denyTargetOptions" width="220px" />
        <Button
          :disabled="!denyRule.trim() || denyBusy"
          variant="outline"
          size="sm"
          @click="onAddDeny"
        >
          <Icon name="shield" />
          {{ t('settingsPermissions.deny.add') }}
        </Button>
      </div>

      <!-- ── Luật đã lưu ──────────────────────────────────────────────────── -->
      <div class="mt-5 mb-2 flex items-center justify-between gap-2">
        <div data-set-label class="text-xs font-medium text-muted-foreground">
          {{ t('settingsPermissions.list.heading') }}
        </div>
        <Button :disabled="loading" variant="outline" size="sm" @click="load">
          <Icon name="refresh" />
          {{ t('settingsPermissions.list.refresh') }}
        </Button>
      </div>

      <div v-if="loaded && rules.length === 0" class="px-0.5 py-2.5 text-sm text-faint">
        {{ t('settingsPermissions.list.empty') }}
      </div>

      <div v-for="group in groups" :key="group.key" class="mt-3">
        <div class="mb-1 flex items-baseline gap-2">
          <span class="text-sm font-semibold text-dim">{{ groupTitle(group) }}</span>
          <!-- mono-ok: đường dẫn file luật, người dùng copy thẳng vào editor/terminal.
               rtl để tên file vẫn thấy khi đường dẫn tràn. -->
          <span
            v-if="group.file"
            class="min-w-0 flex-1 truncate text-left font-mono text-xs text-faint [direction:rtl]"
            :title="group.file"
          >
            {{ group.file }}
          </span>
        </div>
        <div
          v-for="row in group.rows"
          :key="permissionRuleKey(row)"
          class="flex items-center gap-2 border-t px-2 py-1.5"
          :class="{
            'rounded-sm border-t-destructive/40 bg-destructive/10': row.action === 'deny',
            'opacity-60': !row.active,
          }"
        >
          <Badge
            variant="outline"
            class="shrink-0 rounded-sm font-semibold"
            :class="
              row.action === 'deny'
                ? 'border-destructive/40 text-destructive'
                : 'border-selected-border text-primary'
            "
          >
            {{ t('settingsPermissions.action.' + row.action) }}
          </Badge>
          <!-- mono-ok: chuỗi luật là cú pháp máy đọc, copy thẳng được vào file luật JSON -->
          <code class="min-w-0 flex-1 font-mono text-sm wrap-anywhere text-foreground select-text">
            {{ row.rule }}
          </code>
          <Badge
            v-if="!row.active"
            variant="outline"
            class="text-muted-foreground"
            :title="t('settingsPermissions.inactiveHint')"
          >
            {{ t('settingsPermissions.inactive') }}
          </Badge>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0 text-dim hover:bg-destructive/10 hover:text-destructive"
            :disabled="busyKey === permissionRuleKey(row)"
            :title="t('settingsPermissions.delete')"
            :aria-label="t('settingsPermissions.delete')"
            @click="onDelete(row)"
          >
            <Icon name="trash" />
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Settings → Quyền (ADR 0080, F10 + #40). Ba việc: xem luật đã lưu theo tầng,
// thu hồi từng luật, và nhận gợi ý luật rút ra từ lịch sử.
//
// Luật DENY phải phân biệt được với ALLOW chỉ bằng mắt — nhầm hai thứ này là
// nhầm giữa "đã cấp quyền" và "đã dựng rào chắn".
import { computed, onMounted, reactive, ref } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useConfirm } from '~/composables/useConfirm'
import {
  permissionRuleKey,
  type PermissionRuleGroup,
  type PermissionRuleRow,
  type PermissionRuleSuggestion,
} from '~/composables/usePermissionRules'

const { t } = useI18n()
const { confirm } = useConfirm()
const {
  rules,
  groups,
  fileErrors,
  suggestions,
  scanReport,
  loading,
  loaded,
  scanning,
  busyKey,
  lastError,
  available,
  load,
  removeRule,
  scan,
  acceptSuggestion,
  addDenyRule,
} = usePermissionRules()

// Ô "chặn một tool". Đây là công tắc tắt hẳn duy nhất người dùng có: `disabledTools`
// là per-session và mặc định rỗng, nên một tool bật theo mặc định thì bật ở mọi
// phiên chat. Luật DENY thì thắng mọi nới lỏng — kể cả execute mode và auto-approve.
const projects = useProjectsStore()
const denyRule = ref('')
const denyTarget = ref('user')
const denyBusy = ref(false)

const denyTargetOptions = computed(() => [
  { label: t('settingsPermissions.suggest.target.user'), value: 'user' },
  ...projects.projects.map((p) => ({
    label: t('settingsPermissions.suggest.target.project', { name: p.name }),
    value: `project:${p.id}`,
  })),
])

async function onAddDeny(): Promise<void> {
  if (!denyRule.value.trim() || denyBusy.value) return
  denyBusy.value = true
  try {
    if (await addDenyRule(denyRule.value, denyTarget.value)) denyRule.value = ''
  } finally {
    denyBusy.value = false
  }
}

// Tầng đích của từng gợi ý: 'user' hoặc 'project:<id>'. Mặc định là tầng HẸP
// nhất dùng được — gợi ý chỉ đến từ một dự án thì mặc định giới hạn ở dự án đó.
const targets = reactive<Record<string, string>>({})

function targetOptions(s: PermissionRuleSuggestion): { label: string; value: string }[] {
  const options = s.projects.map((p) => ({
    label: t('settingsPermissions.suggest.target.project', { name: p.name }),
    value: `project:${p.id}`,
  }))
  options.push({ label: t('settingsPermissions.suggest.target.user'), value: 'user' })
  return options
}

// Tầng đang chọn — mặc định là tuỳ chọn đầu tiên, tức tầng hẹp nhất dùng được.
function targetOf(s: PermissionRuleSuggestion): string {
  return targets[s.id] ?? targetOptions(s)[0]?.value ?? 'user'
}

function projectNames(s: PermissionRuleSuggestion): string {
  return s.projects.map((p) => p.name).join(', ')
}

function groupTitle(group: PermissionRuleGroup): string {
  if (group.scope === 'user') return t('settingsPermissions.scope.user')
  const key = group.scope === 'project' ? 'project' : 'session'
  return t(`settingsPermissions.scope.${key}`, { name: group.title })
}

async function onAccept(s: PermissionRuleSuggestion): Promise<void> {
  await acceptSuggestion(s, targetOf(s))
}

async function onDelete(row: PermissionRuleRow): Promise<void> {
  const ok = await confirm({
    title: t('settingsPermissions.deleteTitle'),
    // Thu hồi một DENY là GỠ RÀO CHẮN — câu hỏi phải nói khác hẳn lúc thu hồi
    // một ALLOW, nếu không người dùng đọc lướt sẽ tưởng hai việc như nhau.
    description: t(`settingsPermissions.deleteBody.${row.action}`, { rule: row.rule }),
    confirmLabel: t('settingsPermissions.deleteConfirm'),
  })
  if (ok) await removeRule(row)
}

onMounted(() => {
  void load()
})
</script>
