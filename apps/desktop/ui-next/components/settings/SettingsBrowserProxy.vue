<template>
  <div class="flex flex-col gap-2">
    <Separator />
    <Tabs v-model="tab" class="flex flex-col gap-2">
      <TabsList class="self-start">
        <TabsTrigger v-for="tb in tabs" :key="tb.id" :value="tb.id">
          {{ tb.label }}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="manual" class="flex flex-col gap-2">
        <p class="m-0 text-xs text-dim">{{ t('browser.profiles.proxy.note') }}</p>

        <div class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2">
          <label class="pt-1.5 text-sm text-dim">{{ t('browser.profiles.proxy.type') }}</label>
          <AppSelect v-model="kind" :options="typeOptions" width="160px" />

          <template v-if="kind !== 'off'">
            <label class="pt-1.5 text-sm text-dim">{{ t('browser.profiles.proxy.host') }}</label>
            <div class="flex gap-1.5">
              <Input
                v-model="host"
                type="text"
                spellcheck="false"
                :placeholder="t('browser.profiles.proxy.hostPlaceholder')"
              />
              <Input
                v-model="port"
                type="text"
                inputmode="numeric"
                spellcheck="false"
                class="w-21 shrink-0"
                :placeholder="t('browser.profiles.proxy.port')"
                :aria-label="t('browser.profiles.proxy.port')"
              />
            </div>

            <label class="pt-1.5 text-sm text-dim">{{ t('browser.profiles.proxy.auth') }}</label>
            <div class="flex flex-col gap-1.5">
              <p v-if="isSocks" class="m-0 rounded-md border px-2 py-1.5 text-sm text-dim">
                {{ t('browser.profiles.proxy.socksNoAuth') }}
              </p>
              <div
                v-else-if="authSaved && !replacingAuth"
                class="flex flex-wrap items-center gap-1.5"
              >
                <span class="text-sm text-foreground">
                  {{
                    clearingAuth
                      ? t('browser.profiles.proxy.authWillClear')
                      : t('browser.profiles.proxy.authSaved')
                  }}
                </span>
                <Button size="sm" variant="outline" @click="replacingAuth = true">
                  {{ t('browser.profiles.proxy.authReplace') }}
                </Button>
                <Button
                  v-if="!clearingAuth"
                  size="sm"
                  variant="outline"
                  class="text-destructive hover:text-destructive"
                  @click="clearingAuth = true"
                >
                  {{ t('browser.profiles.proxy.authClear') }}
                </Button>
                <Button v-else size="sm" variant="outline" @click="clearingAuth = false">
                  {{ t('common.cancel') }}
                </Button>
              </div>
              <template v-else>
                <Input
                  v-model="username"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="t('browser.profiles.proxy.username')"
                />
                <Input
                  v-model="password"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="t('browser.profiles.proxy.password')"
                />
                <p class="m-0 text-xs text-dim">{{ t('browser.profiles.proxy.authHint') }}</p>
              </template>
            </div>

            <label class="pt-1.5 text-sm text-dim">{{ t('browser.profiles.proxy.bypass') }}</label>
            <div class="flex flex-col gap-1.5">
              <Input
                v-model="bypass"
                type="text"
                spellcheck="false"
                :placeholder="t('browser.profiles.proxy.bypassPlaceholder')"
              />
              <p class="m-0 text-xs text-dim">{{ t('browser.profiles.proxy.bypassHint') }}</p>
            </div>
          </template>
        </div>

        <p v-if="error" class="m-0 text-sm text-destructive" role="alert">{{ error }}</p>

        <div class="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="default" :disabled="saving || !canSave" @click="onSave">
            {{ t('common.save') }}
          </Button>
          <Button
            v-if="bridgeAvailable"
            size="sm"
            variant="outline"
            :disabled="!canTest"
            :title="!profile.proxy ? t('browser.profiles.proxy.testNeedsSave') : undefined"
            @click="onTest"
          >
            {{ testing ? t('browser.profiles.proxy.testing') : t('browser.profiles.proxy.test') }}
          </Button>
          <span
            v-if="testResult"
            class="text-sm wrap-anywhere"
            :class="testResult.ok ? 'text-success' : 'text-destructive'"
            role="status"
          >
            {{ testText }}
          </span>
          <span class="flex-1" />
          <Button size="sm" variant="outline" @click="emit('close')">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="free">
        <FreeProxyPicker :profile="profile" @applied="onFreeApplied" />
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
// Editor proxy theo hồ sơ (ADR 0103) — "VPN" chỉ cho tab của hồ sơ này, không phải cả máy.
//
// Mật khẩu KHÔNG bao giờ quay lại renderer: `hasAuth` chỉ cho biết đã lưu, nên ô chỉ hiện
// trạng thái "đã lưu" + Thay/Xoá. Creds đi một chiều renderer → sidecar (keychain).
// SOCKS5 + user/pass: Chromium không làm được ⇒ khoá ô nhập và nói lý do (sidecar cũng
// từ chối ở biên).
import type { BrowserProfile, BrowserProxyType } from '~/types'
import FreeProxyPicker from '~/components/browser/FreeProxyPicker.vue'
import { useBrowserProfiles } from '~/composables/useBrowserProfiles'
import { sidecarErrorText } from '~/composables/useSidecar'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'

const props = defineProps<{ profile: BrowserProfile }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const api = useBrowserProfiles()

// Bridge có sẵn hay không là hằng của bản chạy (browser-dev không có Electron).
const bridgeAvailable: boolean = typeof window !== 'undefined' && !!window.awog?.browser

const tab = ref<'manual' | 'free'>('manual')
const tabs = computed(() => [
  { id: 'manual' as const, label: t('browser.profiles.proxy.tabManual') },
  { id: 'free' as const, label: t('browser.profiles.free.tab') },
])

// Picker vừa ghi proxy vào hồ sơ này → đồng bộ form tay để không hiện cấu hình cũ/dirty giả.
const onFreeApplied = (p: { type: BrowserProxyType; host: string; port: number }): void => {
  kind.value = p.type
  host.value = p.host
  port.value = String(p.port)
  clearingAuth.value = false
  replacingAuth.value = false
}
type Kind = 'off' | BrowserProxyType
const kind = ref<Kind>(props.profile.proxy?.type ?? 'off')
const host = ref(props.profile.proxy?.host ?? '')
const port = ref(props.profile.proxy ? String(props.profile.proxy.port) : '')
const bypass = ref(props.profile.proxy?.bypass ?? '')
const username = ref('')
const password = ref('')
// Đã có creds trong keychain? Nếu có thì không hiện ô nhập trừ khi bấm "Thay".
const authSaved = computed(() => !!props.profile.proxy?.hasAuth)
const replacingAuth = ref(false)
const clearingAuth = ref(false)

const saving = ref(false)
const testing = ref(false)
const error = ref('')
const testResult = ref<{ ok: boolean; ip?: string; loc?: string; error?: string } | null>(null)

const typeOptions = computed<AppSelectOption[]>(() => [
  { value: 'off', label: t('browser.profiles.proxy.off') },
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' },
])

const isSocks = computed(() => kind.value === 'socks5')

// Chọn SOCKS5 ⇒ bỏ mọi ý định gửi creds (Chromium không hỗ trợ); creds đã lưu sẽ bị xoá khi Save.
watch(isSocks, (v) => {
  if (!v) return
  username.value = ''
  password.value = ''
  replacingAuth.value = false
  clearingAuth.value = false
})

const hostOk = computed(() => {
  const h = host.value.trim()
  return h.length > 0 && h.length <= 253 && !/\s|\/|^[a-z][a-z0-9+.-]*:\/\//i.test(h)
})
const portNum = computed(() => (/^\d{1,5}$/.test(port.value.trim()) ? Number(port.value) : NaN))
const portOk = computed(() => portNum.value >= 1 && portNum.value <= 65535)
const bypassOk = computed(() => bypass.value.length <= 500)
const wantsNewAuth = computed(
  () =>
    !isSocks.value &&
    (!authSaved.value || replacingAuth.value) &&
    !!(username.value || password.value),
)
const authOk = computed(() => !wantsNewAuth.value || (!!username.value && !!password.value))

const canSave = computed(
  () => kind.value === 'off' || (hostOk.value && portOk.value && bypassOk.value && authOk.value),
)

// Kiểm tra chạy trên cấu hình ĐÃ LƯU (main đọc partition thật), nên form đang sửa dở
// thì chưa kiểm được — tránh hiện kết quả của cấu hình khác với cái người dùng đang nhìn.
const dirty = computed(() => {
  const cur = props.profile.proxy
  if (!cur) return kind.value !== 'off'
  return (
    kind.value !== cur.type ||
    host.value.trim() !== cur.host ||
    portNum.value !== cur.port ||
    bypass.value.trim() !== (cur.bypass ?? '') ||
    wantsNewAuth.value ||
    clearingAuth.value
  )
})
const canTest = computed(() => !!props.profile.proxy && !dirty.value && !testing.value)

const testText = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (!r.ok) return r.error || t('browser.profiles.proxy.testFailed')
  return [r.ip, r.loc].filter(Boolean).join(' · ') || t('browser.profiles.proxy.testOk')
})

const onSave = async (): Promise<void> => {
  error.value = ''
  testResult.value = null
  saving.value = true
  try {
    if (kind.value === 'off') {
      await api.setProxy(props.profile.id, null, null)
    } else {
      // auth: vắng = giữ creds cũ; null = xoá (SOCKS5 luôn xoá); object = ghi mới.
      let auth: { username: string; password: string } | null | undefined
      if (isSocks.value || clearingAuth.value) auth = authSaved.value ? null : undefined
      else if (wantsNewAuth.value) auth = { username: username.value, password: password.value }
      await api.setProxy(
        props.profile.id,
        {
          type: kind.value,
          host: host.value.trim(),
          port: portNum.value,
          ...(bypass.value.trim() ? { bypass: bypass.value.trim() } : {}),
        },
        auth,
      )
    }
    // Mật khẩu chỉ sống trong ô nhập đến lúc này.
    username.value = ''
    password.value = ''
    replacingAuth.value = false
    clearingAuth.value = false
    useToast().add({ title: t('browser.profiles.proxy.saved'), color: 'success' })
  } catch (err) {
    error.value = sidecarErrorText(err)
  } finally {
    saving.value = false
  }
}

const onTest = async (): Promise<void> => {
  const bridge = window.awog?.browser
  if (!bridge) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await bridge.testProxy(props.profile.id)
  } catch (err) {
    testResult.value = { ok: false, error: sidecarErrorText(err) }
  } finally {
    testing.value = false
  }
}
</script>
