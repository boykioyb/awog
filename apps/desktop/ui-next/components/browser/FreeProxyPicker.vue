<template>
  <div class="fpp">
    <p class="fpp-warn" role="note">
      <Icon name="warn" class="fpp-warnic" />
      <span>{{ t('browser.profiles.free.warning') }}</span>
    </p>

    <div class="fpp-filters">
      <AppSelect
        v-model="country"
        :options="countryOptions"
        searchable
        :search-placeholder="t('browser.profiles.free.searchCountry')"
        :empty-label="t('browser.profiles.free.noCountry')"
        width="200px"
        :aria-label="t('browser.profiles.free.region')"
        :title="t('browser.profiles.free.region')"
      />
      <AppSelect v-model="typeFilter" :options="typeOptions" width="150px" />
      <Button size="sm" variant="default" :disabled="busy" @click="search()">
        {{ loading ? t('browser.profiles.free.loading') : t('browser.profiles.free.search') }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        :disabled="busy"
        :title="t('browser.profiles.free.refresh')"
        :aria-label="t('browser.profiles.free.refresh')"
        @click="search(true)"
      >
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </Button>
    </div>
    <p v-if="!searched && !loading" class="fpp-hint">{{ t('browser.profiles.free.hint') }}</p>

    <p v-if="error" class="fpp-err" role="alert">{{ error }}</p>
    <p v-for="s in failedSources" :key="s.name" class="fpp-hint fpp-srcfail">
      {{ t('browser.profiles.free.sourceFailed', { name: s.name, error: s.error ?? '' }) }}
    </p>

    <p v-if="searched && !loading && !rows.length && !error" class="fpp-hint">
      {{ t('browser.profiles.free.empty') }}
    </p>

    <template v-if="rows.length">
      <p class="fpp-progress" role="status">
        {{
          t('browser.profiles.free.progress', {
            done: doneCount,
            total: rows.length,
            ok: okCount,
          })
        }}
        <span v-if="probing" class="fpp-spin" aria-hidden="true" />
      </p>

      <div class="fpp-scroll">
        <div class="fpp-table" role="table">
          <div class="fpp-row fpp-headrow" role="row">
            <span role="columnheader">{{ t('browser.profiles.free.colCountry') }}</span>
            <span role="columnheader">{{ t('browser.profiles.free.colType') }}</span>
            <span role="columnheader">{{ t('browser.profiles.free.colHost') }}</span>
            <span role="columnheader" class="fpp-num">
              {{ t('browser.profiles.free.colLatency') }}
            </span>
            <span role="columnheader" class="fpp-num">
              {{ t('browser.profiles.free.colUptime') }}
            </span>
            <span role="columnheader">{{ t('browser.profiles.free.colAnon') }}</span>
            <span role="columnheader" />
          </div>
          <div
            v-for="r in rows"
            :key="r.proxy.id"
            class="fpp-row"
            :class="{ dead: r.probe.state === 'fail', current: isCurrent(r.proxy) }"
            role="row"
          >
            <span class="fpp-country" role="cell" :title="countryTitle(r.proxy)">
              <span class="fpp-flag" aria-hidden="true">{{ flagEmoji(r.proxy.country) }}</span>
              <span class="fpp-ctext">
                {{ r.proxy.countryName || r.proxy.country }}
                <span v-if="r.proxy.city" class="fpp-city">{{ r.proxy.city }}</span>
              </span>
            </span>
            <span role="cell">{{ r.proxy.type === 'socks5' ? 'SOCKS5' : 'HTTP' }}</span>
            <span role="cell" class="fpp-host">
              {{ r.proxy.host }}:{{ r.proxy.port }}
              <span
                v-if="r.probe.state === 'ok' && r.probe.blocked.includes('google')"
                class="fpp-blocked"
                :title="t('browser.profiles.free.blockedGoogleTitle')"
              >
                {{ t('browser.profiles.free.blockedGoogle') }}
              </span>
            </span>
            <span
              role="cell"
              class="fpp-num fpp-lat"
              :style="latencyStyle(r.probe)"
              :title="r.probe.state === 'fail' ? failText(r.probe.error) : undefined"
            >
              {{ latencyText(r.probe) }}
            </span>
            <span role="cell" class="fpp-num">
              {{ r.proxy.uptime != null ? `${Math.round(r.proxy.uptime)}%` : '—' }}
            </span>
            <span role="cell">{{ t(`browser.profiles.free.anon.${r.proxy.anonymity}`) }}</span>
            <span role="cell" class="fpp-acts">
              <template v-if="r.probe.state === 'ok'">
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="applying"
                  @click="onUse(r.proxy, false)"
                >
                  {{ t('browser.profiles.free.use') }}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="applying"
                  :title="t('browser.profiles.free.useNew')"
                  :aria-label="t('browser.profiles.free.useNew')"
                  @click="onUse(r.proxy, true)"
                >
                  <Icon name="users" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </Button>
              </template>
            </span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="applied" class="fpp-applied" role="status">
      <span class="fpp-appliedtxt">{{ appliedText }}</span>
      <Button
        v-if="bridgeAvailable"
        size="sm"
        variant="outline"
        :disabled="testing"
        @click="onTest"
      >
        {{ testing ? t('browser.profiles.proxy.testing') : t('browser.profiles.proxy.test') }}
      </Button>
      <span v-if="testResult" class="fpp-test" :class="testResult.ok ? 'ok' : 'bad'">
        {{ testText }}
      </span>
    </div>
    <p v-if="applyError" class="fpp-err" role="alert">{{ applyError }}</p>
  </div>
</template>

<script setup lang="ts">
// Chọn proxy miễn phí theo vùng + độ trễ ĐO THẬT (docs/features/browser-profiles-bookmarks.md).
//
// Proxy miễn phí do người lạ vận hành: banner cảnh báo luôn hiện. Mọi lệnh gọi mạng chỉ
// chạy khi người dùng bấm Tìm — mở tab không tự gọi. "Dùng" ghi proxy vào hồ sơ đang sửa
// (không auth); nút người-dùng-nhóm tạo hồ sơ riêng rồi gán vào đó.
import type { BrowserProfile, BrowserProxyType, FreeProxy } from '~/types'
import { flagEmoji, useFreeProxies, type ProbeState } from '~/composables/useFreeProxies'
import { useBrowserProfiles } from '~/composables/useBrowserProfiles'
import { sidecarErrorText } from '~/composables/useSidecar'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ profile: BrowserProfile }>()
const emit = defineEmits<{
  applied: [proxy: { type: BrowserProxyType; host: string; port: number }]
}>()

const { t } = useI18n()
const profiles = useBrowserProfiles()
const {
  country,
  typeFilter,
  countries,
  sources,
  loading,
  probing,
  searched,
  error,
  rows,
  okCount,
  doneCount,
  search,
} = useFreeProxies()

const bridgeAvailable: boolean = typeof window !== 'undefined' && !!window.awog?.browser
const busy = computed(() => loading.value || probing.value)

const countryOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('browser.profiles.free.allRegions') },
  ...countries.value.map((c) => ({
    value: c.code,
    label: `${flagEmoji(c.code)} ${c.name || c.code} (${c.count})`,
  })),
])
const typeOptions = computed<AppSelectOption[]>(() => [
  { value: 'all', label: t('browser.profiles.free.typeAll') },
  { value: 'http', label: 'HTTP' },
  { value: 'socks5', label: 'SOCKS5' },
])
const failedSources = computed(() => sources.value.filter((s) => !s.ok))

const countryTitle = (p: FreeProxy): string =>
  [p.countryName || p.country, p.city, p.isp].filter(Boolean).join(' · ')

const latencyText = (p: ProbeState): string =>
  p.state === 'ok' ? `${p.latencyMs} ms` : p.state === 'pending' ? '…' : '✕'
// Mã lỗi của probe → câu đọc được (mã lạ giữ nguyên).
const KNOWN_FAILS = new Set(['tls-reset', 'tls-cert', 'tls-timeout', 'timeout'])
const failText = (code?: string): string =>
  code && KNOWN_FAILS.has(code) ? t(`browser.profiles.free.err.${code}`) : (code ?? '')
// Ngưỡng theo trải nghiệm duyệt web (không phải tải nặng): ≤ 400ms nhanh, ≤ 1200ms tạm được.
const latencyStyle = (p: ProbeState): Record<string, string> => {
  if (p.state !== 'ok') return {}
  const color =
    p.latencyMs <= 400 ? 'var(--green)' : p.latencyMs <= 1200 ? 'var(--amber)' : 'var(--danger)'
  return { color }
}

// ── Áp dụng ──
const applying = ref(false)
const applyError = ref('')
const applied = ref<{ profileId: string; profileName: string; proxy: FreeProxy } | null>(null)
const testing = ref(false)
const testResult = ref<{ ok: boolean; ip?: string; loc?: string; error?: string } | null>(null)

const isCurrent = (p: FreeProxy): boolean => {
  const cur = props.profile.proxy
  return !!cur && cur.type === p.type && cur.host === p.host && cur.port === p.port
}

const onUse = async (p: FreeProxy, newProfile: boolean): Promise<void> => {
  applyError.value = ''
  testResult.value = null
  applying.value = true
  try {
    let target = { id: props.profile.id, name: props.profile.name }
    if (newProfile) {
      const created = await profiles.create(
        t('browser.profiles.free.profileName', { country: p.countryName || p.country }),
      )
      target = { id: created.id, name: created.name }
    }
    await profiles.setProxy(target.id, { type: p.type, host: p.host, port: p.port }, null)
    applied.value = { profileId: target.id, profileName: target.name, proxy: p }
    if (!newProfile) emit('applied', { type: p.type, host: p.host, port: p.port })
    useToast().add({
      title: newProfile
        ? t('browser.profiles.free.appliedNew', { name: target.name })
        : t('browser.profiles.free.applied', { host: `${p.host}:${p.port}` }),
      color: 'success',
    })
  } catch (err) {
    applyError.value = sidecarErrorText(err)
  } finally {
    applying.value = false
  }
}

const appliedText = computed(() => {
  const a = applied.value
  if (!a) return ''
  return a.profileId === props.profile.id
    ? t('browser.profiles.free.appliedHere', { host: `${a.proxy.host}:${a.proxy.port}` })
    : t('browser.profiles.free.appliedElsewhere', {
        name: a.profileName,
        host: `${a.proxy.host}:${a.proxy.port}`,
      })
})

const onTest = async (): Promise<void> => {
  const bridge = window.awog?.browser
  const a = applied.value
  if (!bridge || !a) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await bridge.testProxy(a.profileId)
  } catch (err) {
    testResult.value = { ok: false, error: sidecarErrorText(err) }
  } finally {
    testing.value = false
  }
}

const testText = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (!r.ok) return r.error || t('browser.profiles.proxy.testFailed')
  return [r.ip, r.loc].filter(Boolean).join(' · ') || t('browser.profiles.proxy.testOk')
})
</script>

<style scoped>
.fpp {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fpp-warn {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--amber);
  border-radius: var(--r-sm);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.fpp-warnic {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  margin-top: 2px;
  color: var(--amber);
}
.fpp-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.fpp-hint,
.fpp-progress {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.fpp-progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fpp-srcfail {
  color: var(--amber);
}
.fpp-err {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.fpp-spin {
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: fpp-rot 0.8s linear infinite;
}
@keyframes fpp-rot {
  to {
    transform: rotate(360deg);
  }
}
.fpp-scroll {
  max-height: 340px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.fpp-table {
  min-width: 560px;
}
.fpp-row {
  display: grid;
  grid-template-columns: minmax(110px, 1.3fr) 58px minmax(120px, 1.3fr) 66px 50px 74px 92px;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  min-height: 34px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  box-shadow: inset 0 -1px 0 var(--border);
}
.fpp-headrow {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 28px;
  background: var(--bgEl);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.fpp-row.dead {
  opacity: 0.5;
}
.fpp-row.current {
  background: var(--accentDim);
}
.fpp-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.fpp-country {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.fpp-flag {
  flex: 0 0 auto;
}
.fpp-ctext {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fpp-city {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.fpp-host {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code); /* mono-ok: host:port người dùng có thể copy */
}
.fpp-blocked {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--r-pill);
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
  border: 1px solid var(--amber);
}
.fpp-acts {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.fpp-applied {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.fpp-appliedtxt {
  flex: 1 1 200px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.fpp-test {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow-wrap: anywhere;
}
.fpp-test.ok {
  color: var(--green);
}
.fpp-test.bad {
  color: var(--danger);
}
</style>
