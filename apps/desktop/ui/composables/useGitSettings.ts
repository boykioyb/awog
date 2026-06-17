// Git Manager settings — persisted in localStorage (same pattern as
// `useAppearance`). Sidecar will read the same shape via `settings.get` once
// the Task Execution Engine wires the auto-commit hook (deferred — sidecar
// runner today has no phase lifecycle anchor).
import { storeToRefs } from 'pinia'
import {
  DEFAULT_GIT_SETTINGS,
  useSettingsStore,
  type AutoCommitScope,
  type DirtyTaskPolicy,
  type GitSettings,
} from '~/stores/settings'

const STORAGE_KEY = 'awog.git.v1'

const SCOPE_VALUES: readonly AutoCommitScope[] = ['workspace', 'artifacts-only']
const POLICY_VALUES: readonly DirtyTaskPolicy[] = ['warn', 'auto-stash']

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

export const coerceGitSettings = (raw: unknown): GitSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const interval =
    typeof v.autoFetchIntervalMs === 'number' && v.autoFetchIntervalMs >= 0
      ? Math.floor(v.autoFetchIntervalMs)
      : DEFAULT_GIT_SETTINGS.autoFetchIntervalMs
  return {
    autoCommitPerPhase:
      typeof v.autoCommitPerPhase === 'boolean'
        ? v.autoCommitPerPhase
        : DEFAULT_GIT_SETTINGS.autoCommitPerPhase,
    autoCommitMessageTemplate:
      typeof v.autoCommitMessageTemplate === 'string' && v.autoCommitMessageTemplate.length > 0
        ? v.autoCommitMessageTemplate
        : DEFAULT_GIT_SETTINGS.autoCommitMessageTemplate,
    autoCommitScope: pick(v.autoCommitScope, SCOPE_VALUES, DEFAULT_GIT_SETTINGS.autoCommitScope),
    autoStashDirtyBeforeTask:
      typeof v.autoStashDirtyBeforeTask === 'boolean'
        ? v.autoStashDirtyBeforeTask
        : DEFAULT_GIT_SETTINGS.autoStashDirtyBeforeTask,
    dirtyTaskPolicy: pick(v.dirtyTaskPolicy, POLICY_VALUES, DEFAULT_GIT_SETTINGS.dirtyTaskPolicy),
    autoFetchIntervalMs: interval,
    commitMessageRule:
      typeof v.commitMessageRule === 'string' && v.commitMessageRule.trim().length > 0
        ? v.commitMessageRule
        : DEFAULT_GIT_SETTINGS.commitMessageRule,
    commitCoAuthor:
      typeof v.commitCoAuthor === 'boolean'
        ? v.commitCoAuthor
        : DEFAULT_GIT_SETTINGS.commitCoAuthor,
  }
}

const loadFromStorage = (): GitSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerceGitSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (g: GitSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(g))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useGitSettings = () => {
  const store = useSettingsStore()
  const { git } = storeToRefs(store)
  const initialized = useState('gitSettings:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.git = persisted
    watch(
      git,
      (next) => {
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  return {
    git,
    update: store.updateGit,
    reset: store.resetGit,
    defaults: DEFAULT_GIT_SETTINGS,
  }
}
