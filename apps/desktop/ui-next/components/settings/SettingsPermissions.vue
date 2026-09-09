<template>
  <div>
    <SettingsPaneHeader
      :title="t('settingsPermissions.heading')"
      :subtitle="t('settingsPermissions.subtitle')"
    />

    <div v-if="!available" class="permnote">{{ t('settingsPermissions.unavailable') }}</div>

    <template v-else>
      <div v-if="lastError" class="permnote danger">{{ lastError }}</div>

      <!-- Tệp luật không đọc được: mọi luật trong đó — kể cả luật từ chối — đang
           vô hiệu, nên nó phải hiện lên đầu trang chứ không nằm im trong log. -->
      <div v-for="err in fileErrors" :key="err.file" class="permnote danger">
        <div class="permnoteh">{{ t('settingsPermissions.corrupt.title') }}</div>
        <div>
          {{ t('settingsPermissions.corrupt.body', { file: err.file, reason: err.reason }) }}
        </div>
      </div>

      <!-- ── Gợi ý từ lịch sử ─────────────────────────────────────────────── -->
      <div class="permhead">
        <div class="sech">{{ t('settingsPermissions.suggest.heading') }}</div>
        <button class="btn sm" :disabled="scanning" @click="scan">
          <Icon name="scan" />
          {{
            scanning
              ? t('settingsPermissions.suggest.scanning')
              : t('settingsPermissions.suggest.scan')
          }}
        </button>
      </div>
      <p class="permdesc">{{ t('settingsPermissions.suggest.desc') }}</p>

      <div v-if="scanReport" class="permscan">
        {{
          t('settingsPermissions.suggest.report', {
            sessions: scanReport.sessions,
            kb: Math.round(scanReport.bytes / 1024),
          })
        }}
        <span v-if="scanReport.truncated">{{ t('settingsPermissions.suggest.truncated') }}</span>
      </div>

      <div v-for="s in suggestions" :key="s.id" class="permsug">
        <div class="permsugmain">
          <code class="permrule">{{ s.rule }}</code>
          <div class="permmeta">
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
        <button class="btn sm" :disabled="busyKey === s.id" @click="onAccept(s)">
          {{ t('settingsPermissions.suggest.add') }}
        </button>
      </div>
      <div v-if="scanReport && suggestions.length === 0" class="permempty">
        {{ t('settingsPermissions.suggest.none') }}
      </div>
      <p class="permsafety">{{ t('settingsPermissions.suggest.safety') }}</p>

      <!-- ── Chặn một tool ────────────────────────────────────────────────── -->
      <div class="permhead">
        <div class="sech">{{ t('settingsPermissions.deny.heading') }}</div>
      </div>
      <p class="permdesc">{{ t('settingsPermissions.deny.desc') }}</p>
      <div class="permdeny">
        <input
          v-model="denyRule"
          class="keyinp mono permdenyi"
          :placeholder="t('settingsPermissions.deny.placeholder')"
          @keyup.enter="onAddDeny"
        />
        <AppSelect v-model="denyTarget" :options="denyTargetOptions" class="permdenys" />
        <button class="btn sm" :disabled="!denyRule.trim() || denyBusy" @click="onAddDeny">
          <Icon name="shield" />
          {{ t('settingsPermissions.deny.add') }}
        </button>
      </div>

      <!-- ── Luật đã lưu ──────────────────────────────────────────────────── -->
      <div class="permhead">
        <div class="sech">{{ t('settingsPermissions.list.heading') }}</div>
        <button class="btn sm" :disabled="loading" @click="load">
          <Icon name="refresh" />
          {{ t('settingsPermissions.list.refresh') }}
        </button>
      </div>

      <div v-if="loaded && rules.length === 0" class="permempty">
        {{ t('settingsPermissions.list.empty') }}
      </div>

      <div v-for="group in groups" :key="group.key" class="permgroup">
        <div class="permgrouph">
          <span class="permgroupt">{{ groupTitle(group) }}</span>
          <span v-if="group.file" class="permfile" :title="group.file">{{ group.file }}</span>
        </div>
        <div
          v-for="row in group.rows"
          :key="permissionRuleKey(row)"
          class="permrow"
          :class="{ deny: row.action === 'deny', off: !row.active }"
        >
          <span class="permbadge" :class="row.action === 'deny' ? 'deny' : 'allow'">
            {{ t('settingsPermissions.action.' + row.action) }}
          </span>
          <code class="permrule">{{ row.rule }}</code>
          <span v-if="!row.active" class="tag" :title="t('settingsPermissions.inactiveHint')">
            {{ t('settingsPermissions.inactive') }}
          </span>
          <button
            class="permdel"
            :disabled="busyKey === permissionRuleKey(row)"
            :title="t('settingsPermissions.delete')"
            @click="onDelete(row)"
          >
            <Icon name="trash" />
          </button>
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

<style scoped>
.permdeny {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.permdenyi {
  flex: 1;
  min-width: 0;
}
.permdenys {
  width: 220px;
  flex: none;
}
.permnote {
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.permnote.danger {
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  color: var(--danger);
}
.permnoteh {
  font-weight: 600;
}
.permhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.permdesc,
.permsafety {
  margin: 0 0 8px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.permsafety {
  margin-top: 8px;
  color: var(--textFaint);
}
.permscan {
  margin-bottom: 8px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.permempty {
  padding: 10px 2px;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
}
.permsug {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.permsugmain {
  flex: 1;
  min-width: 0;
}
.permmeta {
  margin-top: 2px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.permgroup {
  margin-top: 12px;
}
.permgrouph {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.permgroupt {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.permfile {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--textFaint);
  /* mono-ok: đường dẫn file luật, người dùng copy thẳng vào editor/terminal */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
.permrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}
.permrow.deny {
  background: var(--dangerDim);
  border-radius: var(--r-xs);
  border-top-color: var(--dangerBorder);
}
.permrow.off {
  opacity: 0.6;
}
.permbadge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
}
.permbadge.deny {
  border-color: var(--dangerBorder);
  color: var(--danger);
}
.permrule {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  /* mono-ok: chuỗi luật là cú pháp máy đọc, copy thẳng được vào file luật JSON */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  user-select: text;
}
.permdel {
  flex: 0 0 auto;
  padding: 5px;
  border: 0;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--textDim);
  cursor: pointer;
}
.permdel:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.permdel .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
