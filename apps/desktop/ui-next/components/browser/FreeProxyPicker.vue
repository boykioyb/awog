<template>
  <div class="flex flex-col gap-2">
    <p
      class="m-0 flex items-start gap-2 rounded-md border border-warning px-2.5 py-2 text-sm text-foreground"
      role="note"
    >
      <Icon name="warn" class="mt-0.5 size-3.5 flex-none text-warning" />
      <span>{{ t('browser.profiles.free.warning') }}</span>
    </p>

    <div class="flex flex-wrap items-center gap-1.5">
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
        class="[&_svg]:size-3.5"
        :disabled="busy"
        :title="t('browser.profiles.free.refresh')"
        :aria-label="t('browser.profiles.free.refresh')"
        @click="search(true)"
      >
        <Icon name="refresh" />
      </Button>
    </div>
    <p v-if="!searched && !loading" class="m-0 text-xs text-muted-foreground">
      {{ t('browser.profiles.free.hint') }}
    </p>

    <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-for="s in failedSources" :key="s.name" class="m-0 text-xs text-warning">
      {{ t('browser.profiles.free.sourceFailed', { name: s.name, error: s.error ?? '' }) }}
    </p>

    <p
      v-if="searched && !loading && !rows.length && !error"
      class="m-0 text-xs text-muted-foreground"
    >
      {{ t('browser.profiles.free.empty') }}
    </p>

    <template v-if="rows.length">
      <p class="m-0 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        {{
          t('browser.profiles.free.progress', {
            done: doneCount,
            total: rows.length,
            ok: okCount,
          })
        }}
        <span
          v-if="probing"
          class="size-2.5 animate-spin rounded-full border-2 border-border border-t-primary"
          aria-hidden="true"
        />
      </p>

      <!-- Vùng cuộn ngoài giữ cả hai trục; container của Table bỏ overflow để header
           sticky bám đúng vùng cuộn này (container tự cuộn thì sticky chết). -->
      <div
        class="max-h-85 overflow-auto rounded-md border [&_[data-slot=table-container]]:overflow-visible"
      >
        <Table class="min-w-140">
          <TableHeader class="sticky top-0 z-1 bg-card">
            <TableRow class="hover:bg-transparent">
              <TableHead class="h-ctrl-xs text-xs">
                {{ t('browser.profiles.free.colCountry') }}
              </TableHead>
              <TableHead class="h-ctrl-xs w-14.5 text-xs">
                {{ t('browser.profiles.free.colType') }}
              </TableHead>
              <TableHead class="h-ctrl-xs text-xs">
                {{ t('browser.profiles.free.colHost') }}
              </TableHead>
              <TableHead class="h-ctrl-xs w-16.5 text-right text-xs">
                {{ t('browser.profiles.free.colLatency') }}
              </TableHead>
              <TableHead class="h-ctrl-xs w-12.5 text-right text-xs">
                {{ t('browser.profiles.free.colUptime') }}
              </TableHead>
              <TableHead class="h-ctrl-xs w-18.5 text-xs">
                {{ t('browser.profiles.free.colAnon') }}
              </TableHead>
              <TableHead class="h-ctrl-xs w-23 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="r in rows"
              :key="r.proxy.id"
              class="text-foreground"
              :class="[
                r.probe.state === 'fail' && 'opacity-50',
                isCurrent(r.proxy) && 'bg-selected hover:bg-selected',
              ]"
            >
              <TableCell class="px-2 py-1" :title="countryTitle(r.proxy)">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="flex-none" aria-hidden="true">{{ flagEmoji(r.proxy.country) }}</span>
                  <span class="flex min-w-0 flex-col truncate">
                    {{ r.proxy.countryName || r.proxy.country }}
                    <span v-if="r.proxy.city" class="truncate text-xs text-muted-foreground">
                      {{ r.proxy.city }}
                    </span>
                  </span>
                </span>
              </TableCell>
              <TableCell class="px-2 py-1">
                {{ r.proxy.type === 'socks5' ? 'SOCKS5' : 'HTTP' }}
              </TableCell>
              <!-- host:port người dùng có thể copy ⇒ mono. -->
              <TableCell class="max-w-0 truncate px-2 py-1 font-mono">
                {{ r.proxy.host }}:{{ r.proxy.port }}
                <Badge
                  v-if="r.probe.state === 'ok' && r.probe.blocked.includes('google')"
                  variant="outline"
                  class="ml-1.5 border-warning px-1.5 py-0 font-sans font-normal text-warning"
                  :title="t('browser.profiles.free.blockedGoogleTitle')"
                >
                  {{ t('browser.profiles.free.blockedGoogle') }}
                </Badge>
              </TableCell>
              <TableCell
                class="tnum px-2 py-1 text-right"
                :class="latencyClass(r.probe)"
                :title="r.probe.state === 'fail' ? failText(r.probe.error) : undefined"
              >
                {{ latencyText(r.probe) }}
              </TableCell>
              <TableCell class="tnum px-2 py-1 text-right">
                {{ r.proxy.uptime != null ? `${Math.round(r.proxy.uptime)}%` : '—' }}
              </TableCell>
              <TableCell class="px-2 py-1">
                {{ t(`browser.profiles.free.anon.${r.proxy.anonymity}`) }}
              </TableCell>
              <TableCell class="px-2 py-1">
                <div class="flex justify-end gap-1">
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
                      class="[&_svg]:size-3.5"
                      :disabled="applying"
                      :title="t('browser.profiles.free.useNew')"
                      :aria-label="t('browser.profiles.free.useNew')"
                      @click="onUse(r.proxy, true)"
                    >
                      <Icon name="users" />
                    </Button>
                  </template>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </template>

    <div
      v-if="applied"
      class="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5"
      role="status"
    >
      <span class="flex-[1_1_12.5rem] text-sm text-foreground">{{ appliedText }}</span>
      <Button
        v-if="bridgeAvailable"
        size="sm"
        variant="outline"
        :disabled="testing"
        @click="onTest"
      >
        {{ testing ? t('browser.profiles.proxy.testing') : t('browser.profiles.proxy.test') }}
      </Button>
      <span
        v-if="testResult"
        class="text-sm wrap-anywhere"
        :class="testResult.ok ? 'text-success' : 'text-destructive'"
      >
        {{ testText }}
      </span>
    </div>
    <p v-if="applyError" class="m-0 text-sm text-destructive" role="alert">{{ applyError }}</p>
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
const latencyClass = (p: ProbeState): string => {
  if (p.state !== 'ok') return ''
  return p.latencyMs <= 400
    ? 'text-success'
    : p.latencyMs <= 1200
      ? 'text-warning'
      : 'text-destructive'
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
