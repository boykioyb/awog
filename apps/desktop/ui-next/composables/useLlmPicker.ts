import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { providerModelDisplayName, providerModelIds } from '~/composables/useProviderModels'
import type { ProviderName } from '~/types'

// Bộ chọn provider → account → model dùng chung cho các chỗ "ghim một model riêng"
// (model dịch chung ở Settings → Defaults, model dịch riêng của Slack). Tách khỏi
// useTranslateSettings để hai nơi cùng MỘT logic lấy danh sách account/model theo provider
// và tự chỉnh model khi đổi provider/account, thay vì chép lại.
//
// `source` là nơi giữ lựa chọn (store settings, cài đặt Slack…); mọi ghi đi qua
// `source.update` để state chỉ bị sửa ở một chỗ.

export type LlmPick = { provider: ProviderName; modelId: string; accountId?: string }

export type LlmPickSource = {
  get: () => LlmPick
  update: (patch: Partial<LlmPick>) => void
}

export const LLM_PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

// Sentinel của AppSelect cho "account đang active của provider" (accountId undefined).
export const ACTIVE_ACCOUNT = '__active'

export function useLlmPicker(source: LlmPickSource) {
  const settings = useSettingsStore()

  const accounts = computed(() => settings.providers[source.get().provider]?.accounts ?? [])

  // Model của endpoint TUỲ CHỈNH (danh sách riêng của nó), không thì catalog chung của
  // provider. Account dựng sẵn dùng chung danh sách provider — `account.models` cũ không
  // còn giới hạn picker (model thuộc provider).
  const availableModelIds = computed<string[]>(() => {
    const cur = source.get()
    const cfg = settings.providers[cur.provider]
    const id = cur.accountId ?? cfg?.activeAccountId ?? null
    const acct = cfg?.accounts.find((a) => a.id === id)
    if (acct?.baseURL && acct.models?.length) return acct.models
    return providerModelIds(cur.provider)
  })

  const modelLabel = (id: string): string => providerModelDisplayName(id)

  function reconcileModel(): void {
    if (!availableModelIds.value.includes(source.get().modelId)) {
      const first = availableModelIds.value[0]
      if (first) source.update({ modelId: first })
    }
  }

  const provider = computed<string>({
    get: () => source.get().provider,
    set: (value) => {
      const p = value as ProviderName
      if (source.get().provider === p) return
      source.update({ provider: p, accountId: undefined })
      reconcileModel()
    },
  })

  // ACTIVE_ACCOUNT ↔ undefined (theo account đang active của provider).
  const accountId = computed<string>({
    get: () => source.get().accountId ?? ACTIVE_ACCOUNT,
    set: (v) => {
      source.update({ accountId: v === ACTIVE_ACCOUNT ? undefined : v })
      reconcileModel()
    },
  })

  const modelId = computed<string>({
    get: () => source.get().modelId,
    set: (id) => source.update({ modelId: id }),
  })

  return { provider, accountId, modelId, accounts, availableModelIds, modelLabel }
}
