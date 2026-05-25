import { defineStore } from 'pinia'
import type { AgentMode, ProviderName, ThinkingLevel } from '~/types'
import { keyFingerprintHex } from '~/utils/crypto'

export interface ProviderAccount {
  id: string
  label: string
  apiKey: string
  fingerprint: string
  version: number
}

export type ProviderAccountInput = Pick<ProviderAccount, 'label' | 'apiKey'>

interface ProviderConfig {
  accounts: ProviderAccount[]
  activeAccountId: string | null
}

interface ConnectorConfig {
  connected: boolean
}

type ProviderRecord<T> = Record<ProviderName, T>

export interface SessionDefaults {
  systemPrompt: string
  instructions: string
  provider: ProviderName
  modelId: string
  mode: AgentMode
  thinkingLevel: ThinkingLevel
}

export interface CustomProvider {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  models: string[]
}

export type CustomProviderInput = Omit<CustomProvider, 'id'>

interface SettingsState {
  workspacePath: string
  autoApprove: boolean
  notificationsEnabled: boolean
  providers: ProviderRecord<ProviderConfig>
  customProviders: CustomProvider[]
  contextProviders: {
    notion: ConnectorConfig
    jira: ConnectorConfig
    slack: ConnectorConfig
  }
  defaults: SessionDefaults
}

const seedAccount = (label: string, apiKey: string): ProviderAccount => ({
  id: `acc${Math.random().toString(36).slice(2, 10)}`,
  label,
  apiKey,
  fingerprint: '',
  version: 0,
})

const initialAnthropic = seedAccount('Default', 'sk-ant-***************')
const initialOpenai = seedAccount('Default', 'sk-***************')

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    workspacePath: '~/workspaces/acme-platform',
    autoApprove: false,
    notificationsEnabled: true,
    providers: {
      anthropic: { accounts: [initialAnthropic], activeAccountId: initialAnthropic.id },
      openai: { accounts: [initialOpenai], activeAccountId: initialOpenai.id },
      google: { accounts: [], activeAccountId: null },
    },
    customProviders: [],
    contextProviders: {
      notion: { connected: true },
      jira: { connected: true },
      slack: { connected: false },
    },
    defaults: {
      systemPrompt:
        'You are an AI teammate in AWOG. Be concise, propose plans before destructive edits, and respect approval gates.',
      instructions: '',
      provider: 'anthropic',
      modelId: 'claude-opus-4-7',
      mode: 'ask',
      thinkingLevel: 'high',
    },
  }),
  getters: {
    activeAccount(state): (provider: ProviderName) => ProviderAccount | null {
      return (provider) => {
        const config = state.providers[provider]
        if (!config.activeAccountId) return null
        return config.accounts.find((a) => a.id === config.activeAccountId) ?? null
      }
    },
    isProviderConnected(): (provider: ProviderName) => boolean {
      return (provider) => {
        const account = this.activeAccount(provider)
        return !!account && account.apiKey.length > 0
      }
    },
    keyFingerprint(): (provider: ProviderName) => string {
      return (provider) => this.activeAccount(provider)?.fingerprint ?? ''
    },
  },
  actions: {
    async addProviderAccount(
      provider: ProviderName,
      input: ProviderAccountInput,
    ): Promise<ProviderAccount> {
      const account: ProviderAccount = {
        id: `acc${Date.now()}`,
        label: input.label.trim() || 'Untitled',
        apiKey: input.apiKey,
        fingerprint: input.apiKey ? await keyFingerprintHex(input.apiKey) : '',
        version: 1,
      }
      const config = this.providers[provider]
      config.accounts.push(account)
      if (!config.activeAccountId) config.activeAccountId = account.id
      return account
    },
    async updateProviderAccount(
      provider: ProviderName,
      accountId: string,
      patch: Partial<ProviderAccountInput>,
    ) {
      const account = this.providers[provider].accounts.find((a) => a.id === accountId)
      if (!account) return
      if (patch.label !== undefined) account.label = patch.label
      if (patch.apiKey !== undefined && patch.apiKey !== account.apiKey) {
        account.apiKey = patch.apiKey
        account.version += 1
        account.fingerprint = patch.apiKey ? await keyFingerprintHex(patch.apiKey) : ''
      }
    },
    removeProviderAccount(provider: ProviderName, accountId: string) {
      const config = this.providers[provider]
      config.accounts = config.accounts.filter((a) => a.id !== accountId)
      if (config.activeAccountId === accountId) {
        config.activeAccountId = config.accounts[0]?.id ?? null
      }
    },
    setActiveAccount(provider: ProviderName, accountId: string | null) {
      const config = this.providers[provider]
      if (accountId !== null && !config.accounts.some((a) => a.id === accountId)) return
      config.activeAccountId = accountId
    },
    addCustomProvider(input: CustomProviderInput): CustomProvider {
      const provider: CustomProvider = { ...input, id: `cp${Date.now()}` }
      this.customProviders.push(provider)
      return provider
    },
    updateCustomProvider(id: string, patch: Partial<CustomProviderInput>) {
      const idx = this.customProviders.findIndex((p) => p.id === id)
      if (idx < 0) return
      this.customProviders[idx] = { ...this.customProviders[idx]!, ...patch }
    },
    removeCustomProvider(id: string) {
      this.customProviders = this.customProviders.filter((p) => p.id !== id)
    },
    toggleConnector(connector: 'notion' | 'jira' | 'slack') {
      this.contextProviders[connector].connected = !this.contextProviders[connector].connected
    },
    updateDefaults(patch: Partial<SessionDefaults>) {
      this.defaults = { ...this.defaults, ...patch }
    },
  },
})
