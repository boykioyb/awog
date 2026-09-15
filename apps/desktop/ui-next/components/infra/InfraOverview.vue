<template>
  <div class="scroll">
    <div class="iov-head">
      <h2 class="iov-title">{{ t('infra.ov.title') }}</h2>
      <span v-if="updatedAt" class="iov-when">
        {{ t('infra.ov.updated', { when: updatedLabel }) }}
      </span>
      <button class="btn sm" type="button" :disabled="loading" @click="refresh">
        <Icon name="refresh" />
        {{ t('infra.ov.refresh') }}
      </button>
    </div>
    <p class="iov-sub">{{ t('infra.ov.subtitle') }}</p>
    <p v-if="!pinnedProfile" class="iov-note">
      <Icon name="alert" class="iov-note-ic" />
      <span>{{ t('infra.ov.noProfile') }}</span>
    </p>

    <!-- Bento của app: 12 cột, mỗi thẻ một ô. Đây là màn DUY NHẤT nạp nhiều nguồn
         cùng lúc, nên nó ghi rõ thời điểm đọc và chỉ đọc lại khi người dùng bấm. -->
    <div class="bento">
      <div class="tile c12">
        <div class="th">
          <Icon name="layers" />
          <span class="tt">{{ t('infra.ov.facts') }}</span>
        </div>
        <div class="iov-facts">
          <div v-for="f in facts" :key="f.key" class="iov-fact">
            <span class="iov-fact-k">{{ f.label }}</span>
            <span class="iov-fact-v">{{ f.value }}</span>
            <span v-if="f.sub" class="iov-fact-s">{{ f.sub }}</span>
          </div>
        </div>
      </div>

      <div v-for="card in cards" :key="card.id" class="tile c4 iov-card">
        <div class="th">
          <span
            class="iov-lamp"
            :class="`lamp-${card.lamp}`"
            role="img"
            :title="lampLabel(card.lamp)"
            :aria-label="lampLabel(card.lamp)"
          />
          <span class="tt">{{ card.title }}</span>
        </div>
        <p class="iov-text">{{ card.text }}</p>
        <p v-if="card.note" class="iov-card-note">{{ card.note }}</p>
        <div class="iov-acts">
          <button
            v-for="action in card.actions"
            :key="action.id"
            class="btn sm"
            :class="{ pri: action.kind === 'primary' }"
            type="button"
            :disabled="action.disabled"
            @click="action.run()"
          >
            {{ action.label }}
          </button>
        </div>
      </div>

      <div class="tile c12">
        <div class="th">
          <Icon name="message" />
          <span class="tt">{{ t('infra.ov.askHint') }}</span>
        </div>
        <div class="iov-chips">
          <button
            v-for="chip in suggestions"
            :key="chip"
            class="chip iov-chip"
            type="button"
            @click="askAgent(chip)"
          >
            {{ chip }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn Tổng quan (Mốc 2 việc 2.8). Trang chỉ hiển thị; state/luồng ở
// useInfraOverview().
//
// LUẬT CỦA MÀN NÀY — ĐÈN XÁM KHÔNG PHẢI ĐÈN XANH.
// `infra-explorer.md` §Màn mở đầu định nghĩa sáu thẻ đèn cho sáu nguồn dữ liệu. HAI
// nguồn đã nối: Logs (thẻ Lỗi) và EC2 (thẻ Máy chủ — dùng luôn view `ec2.instances`
// của Mốc 3). Bốn nguồn còn lại (CloudFront/Route53, chi phí, ACM, Amplify/CI) thuộc
// Mốc 4–7. Thẻ chưa có nguồn hiện ĐÈN XÁM kèm câu nói rõ "chưa đọc được" và đường
// hỏi agent. Hiện đèn xanh cho một thứ chưa kiểm tra là nói dối người dùng — đúng
// thứ tệ nhất mà một màn "có ổn không" có thể làm.
//
// Mọi số liệu ở đây hoặc MIỄN PHÍ (binary trên máy, ma trận quyền, profile trong
// ~/.aws, thư viện câu lệnh trên đĩa) hoặc chỉ chạy sau một cú bấm: thẻ Máy chủ đọc
// `ec2 describe-instances` (không tốn tiền, nhưng vẫn cần người bấm), thẻ Lỗi đi hai
// bước có nhìn thấy số tiền (Ước lượng → Chạy).
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import {
  OVERVIEW_ERRORS_WINDOW_SECONDS,
  OVERVIEW_OPEN_LOGS_QUERY,
  useInfraOverview,
  type OvCommandClass,
  type OvLamp,
  type OvMode,
} from '~/composables/useInfraOverview'

type OvFact = { key: string; label: string; value: string; sub?: string }
type OvAction = {
  id: string
  label: string
  kind: 'primary' | 'plain'
  disabled?: boolean
  run: () => void
}
type OvCard = {
  id: string
  title: string
  text: string
  note?: string
  lamp: OvLamp
  actions: OvAction[]
}

const emit = defineEmits<{ 'open-logs': [query: string] }>()

const { t } = useI18n()
const { askAgent } = useInfraAskAgent()

const {
  pinnedProfile,
  pinnedRegion,
  tools,
  profiles,
  matrix,
  prodAccountIds,
  bypassUntil,
  updatedAt,
  loading,
  refresh,
  checkGroups,
  estimate,
  estimating,
  running,
  result,
  checkError,
  errorsLamp,
  canEstimate,
  canRun,
  estimateErrors,
  runErrors,
  cancelCheck,
  servers,
  serversReading,
  serversError,
  serversLamp,
  readServers,
} = useInfraOverview()

const updatedLabel = computed(() =>
  updatedAt.value ? new Date(updatedAt.value).toLocaleTimeString() : '',
)

function lampLabel(value: OvLamp): string {
  return t(`infra.ov.lamp.${value}`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

const windowLabel = computed(() =>
  t('infra.logs.window.hours', { n: OVERVIEW_ERRORS_WINDOW_SECONDS / 3600 }),
)

/** Bốn dữ kiện đọc được ngay, không chạm mạng. */
const facts = computed<OvFact[]>(() => {
  const out: OvFact[] = []

  out.push({
    key: 'account',
    label: t('infra.ov.fact.account'),
    value: pinnedProfile.value
      ? `${pinnedProfile.value}${pinnedRegion.value ? ` · ${pinnedRegion.value}` : ''}`
      : t('infra.ov.fact.accountNone'),
  })

  const prod = profiles.value.filter(
    (p) => p.accountId.length > 0 && prodAccountIds.value.includes(p.accountId),
  ).length
  out.push({
    key: 'profiles',
    label: t('infra.ov.fact.profiles'),
    value: t('infra.ov.fact.profilesValue', { n: profiles.value.length, prod }),
  })

  const found = tools.value.filter((tool) => tool.found)
  out.push({
    key: 'tools',
    label: t('infra.ov.fact.tools'),
    value: found.length
      ? t('infra.ov.fact.toolsValue', {
          sorted: found
            .map((tool) => `${tool.tool}${tool.version ? ` ${tool.version}` : ''}`)
            .join(' · '),
        })
      : t('infra.ov.fact.toolsNone'),
  })

  const mode = (cls: OvCommandClass, kind: 'normal' | 'production'): string => {
    const value: OvMode | undefined = matrix.value[cls]?.[kind]
    return value ? t(`infra.ov.mode.${value}`) : '—'
  }
  const dims = (kind: 'normal' | 'production'): Record<string, string> => ({
    read: mode('read', kind),
    write: mode('write', kind),
    destructive: mode('destructive', kind),
  })
  out.push({
    key: 'perms',
    label: t('infra.ov.fact.perms'),
    value: t('infra.ov.fact.permsValue', dims('normal')),
    sub: `${t('infra.ov.fact.permsProd', dims('production'))} · ${
      bypassUntil.value
        ? t('infra.ov.fact.bypass', { until: new Date(bypassUntil.value).toLocaleTimeString() })
        : t('infra.ov.fact.noBypass')
    }`,
  })

  return out
})

function askAction(id: string, question: string): OvAction {
  return { id, label: t('infra.ov.ask'), kind: 'plain', run: () => void askAgent(question) }
}

function openLogsAction(): OvAction {
  return {
    id: 'open',
    label: t('infra.ov.card.errors.open'),
    kind: 'plain',
    run: () => {
      emit('open-logs', OVERVIEW_OPEN_LOGS_QUERY)
    },
  }
}

/** Dòng trạng thái của thẻ Lỗi: nói đúng nó đang ở bước nào của hai cú bấm. */
const errorsNote = computed<string>(() => {
  if (checkGroups.value.length === 0) return t('infra.ov.card.errors.noGroups')
  const groups = checkGroups.value.join(', ')
  if (running.value) return t('infra.ov.card.errors.running')
  if (checkError.value) return t('infra.ov.card.errors.failed', { error: checkError.value })
  if (result.value) {
    const dims = {
      window: windowLabel.value,
      size: formatBytes(result.value.bytes),
      n: result.value.n,
    }
    return result.value.n > 0
      ? t('infra.ov.card.errors.found', dims)
      : t('infra.ov.card.errors.none', dims)
  }
  if (estimate.value) {
    return `${t('infra.ov.card.errors.estimated', {
      size: formatBytes(estimate.value.bytes),
      usd: estimate.value.usd.toFixed(4),
    })} · ${t('infra.ov.card.errors.groups', { n: checkGroups.value.length, groups })}`
  }
  return t('infra.ov.card.errors.groups', { n: checkGroups.value.length, groups })
})

/** Bao nhiêu tên máy chủ nêu ra là đủ để nhận diện, mà thẻ không biến thành một dòng chữ. */
const SERVERS_NAMES_MAX = 3

/** Thẻ Máy chủ: chữ đổi theo ĐÚNG thứ đã đo. Chưa bấm thì vẫn là đèn xám + lời mời. */
const serversText = computed<string>(() => {
  if (serversReading.value) return t('infra.ov.card.servers.reading')
  const s = servers.value
  if (!s) return t('infra.ov.card.servers.text')
  return t('infra.ov.card.servers.measured', { total: s.total, running: s.running })
})

const serversNote = computed<string>(() => {
  if (serversError.value) return t('infra.ov.card.servers.failed', { error: serversError.value })
  const s = servers.value
  if (!s) return ''
  const parts: string[] = []
  if (s.notRunning.length > 0) {
    const names = s.notRunning.slice(0, SERVERS_NAMES_MAX).join(', ')
    const rest = s.notRunning.length - SERVERS_NAMES_MAX
    parts.push(
      rest > 0
        ? t('infra.ov.card.servers.downMore', { n: s.notRunning.length, names, rest })
        : t('infra.ov.card.servers.down', { n: s.notRunning.length, names }),
    )
  }
  // Một trang CLI là 200 dòng: không nói ra thì con số trên thẻ bị đọc thành tổng.
  if (s.nextToken) parts.push(t('infra.ov.card.servers.partial'))
  return parts.join(' · ')
})

const cards = computed<OvCard[]>(() => {
  const errorsActions: OvAction[] = []
  if (running.value) {
    // Đang chạy thì đường thoát duy nhất phải là HUỶ, không phải "Mở trong Logs" —
    // người dùng vừa bấm một lệnh tốn tiền và cần dừng được nó ngay tại chỗ.
    errorsActions.push({
      id: 'cancel',
      label: t('infra.ov.cancel'),
      kind: 'plain',
      run: () => void cancelCheck(),
    })
  }
  if (checkGroups.value.length > 0 && !running.value) {
    if (estimate.value === null || result.value !== null) {
      errorsActions.push({
        id: 'estimate',
        label: t('infra.ov.card.errors.estimateAction'),
        kind: result.value ? 'plain' : 'primary',
        disabled: !canEstimate.value || estimating.value,
        run: () => void estimateErrors(),
      })
    }
    if (estimate.value !== null) {
      errorsActions.push({
        id: 'run',
        label: t('infra.ov.card.errors.runAction', { usd: estimate.value.usd.toFixed(4) }),
        kind: 'primary',
        disabled: !canRun.value,
        run: () => void onRunErrors(),
      })
    }
  }
  errorsActions.push(openLogsAction())

  // Thẻ Máy chủ giữ đúng một đường đọc, và nó chỉ hiện khi người dùng bấm. Nút
  // "Đọc tiếp" chỉ có mặt khi CLI còn token — đó là lúc con số trên thẻ CHƯA phải
  // toàn bộ máy chủ, và im lặng về chuyện đó là nói dối.
  const serversActions: OvAction[] = [
    {
      id: 'read',
      label: servers.value
        ? t('infra.ov.card.servers.reloadAction')
        : t('infra.ov.card.servers.readAction'),
      kind: servers.value ? 'plain' : 'primary',
      disabled: serversReading.value,
      run: () => void readServers(),
    },
  ]
  if (servers.value?.nextToken) {
    serversActions.push({
      id: 'more',
      label: t('infra.ov.card.servers.moreAction'),
      kind: 'primary',
      disabled: serversReading.value,
      run: () => void readServers(servers.value?.nextToken ?? undefined),
    })
  }
  serversActions.push(askAction('servers-ask', t('infra.ov.card.servers.ask')))

  return [
    {
      id: 'website',
      title: t('infra.ov.card.website.title'),
      text: t('infra.ov.card.website.text'),
      lamp: 'unknown',
      actions: [askAction('website-ask', t('infra.ov.card.website.ask'))],
    },
    {
      id: 'errors',
      title: t('infra.ov.card.errors.title'),
      text: t('infra.ov.card.errors.text'),
      note: errorsNote.value,
      lamp: errorsLamp.value,
      actions: errorsActions,
    },
    {
      id: 'servers',
      title: t('infra.ov.card.servers.title'),
      text: serversText.value,
      note: serversNote.value,
      lamp: serversLamp.value,
      actions: serversActions,
    },
    {
      id: 'cost',
      title: t('infra.ov.card.cost.title'),
      text: t('infra.ov.card.cost.text'),
      lamp: 'unknown',
      actions: [askAction('cost-ask', t('infra.ov.card.cost.ask'))],
    },
    {
      id: 'tls',
      title: t('infra.ov.card.tls.title'),
      text: t('infra.ov.card.tls.text'),
      lamp: 'unknown',
      actions: [askAction('tls-ask', t('infra.ov.card.tls.ask'))],
    },
    {
      id: 'deploy',
      title: t('infra.ov.card.deploy.title'),
      text: t('infra.ov.card.deploy.text'),
      lamp: 'unknown',
      actions: [askAction('deploy-ask', t('infra.ov.card.deploy.ask'))],
    },
  ]
})

const suggestions = computed<string[]>(() => [
  t('infra.ov.sug.errors'),
  t('infra.ov.sug.servers'),
  t('infra.ov.sug.cost'),
  t('infra.ov.sug.tls'),
  t('infra.ov.sug.slow'),
  t('infra.ov.sug.deploy'),
])

/**
 * Chạy rồi ĐỌC LẠI ước lượng: lần chạy vừa xong đã ghi `bytesScanned` thật vào thư
 * viện, nên lần sau con số trên nút là số ĐO ĐƯỢC chứ không còn là trần trên.
 */
async function onRunErrors(): Promise<void> {
  await runErrors()
  if (result.value) void estimateErrors()
}

onMounted(() => {
  void refresh()
})
</script>

<style scoped>
.iov-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.iov-title {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}

.iov-when {
  margin-left: auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.iov-sub {
  margin: 0 0 14px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
}

.iov-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-sm);
  background: var(--amberDim);
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.iov-note-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--amber);
}

.iov-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 14px;
}

.iov-fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.iov-fact-k {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.iov-fact-v {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  overflow-wrap: anywhere;
}

.iov-fact-s {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.iov-card {
  min-height: 168px;
}

.iov-lamp {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
  border-radius: var(--r-pill);
  background: var(--textFaint);
}

.iov-lamp.lamp-ok {
  background: var(--green);
}

.iov-lamp.lamp-warn {
  background: var(--amber);
}

.iov-lamp.lamp-bad {
  background: var(--danger);
}

.iov-text {
  margin: 0 0 8px;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
}

.iov-card-note {
  margin: 0 0 10px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.iov-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.iov-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.iov-chip {
  cursor: pointer;
}

.iov-chip:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
</style>
