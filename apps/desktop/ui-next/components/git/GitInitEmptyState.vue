<template>
  <div class="ginit">
    <div class="ginit-card">
      <div class="ginit-icon">
        <Icon name="git" style="width: 26px; height: 26px; color: var(--accent)" />
      </div>

      <div class="ginit-title">{{ t('git.init.title') }}</div>
      <div v-if="projectPath" class="ginit-path mono gtrunc" :title="projectPath">
        {{ projectPath }}
      </div>
      <p class="ginit-desc">{{ t('git.init.desc') }}</p>

      <!-- Commit identity — git refuses to commit without user.name / user.email.
           Prefilled from the global config; saved to ~/.gitconfig on init. -->
      <div class="ginit-sec">
        <div class="ginit-sec-head">
          <Icon name="globe" style="width: 13px; height: 13px; color: var(--textDim)" />
          <span class="ginit-sec-title">{{ t('git.init.identityTitle') }}</span>
        </div>
        <p class="ginit-hint">{{ t('git.init.identityHint') }}</p>
        <label class="ginit-field">
          <span class="ginit-label">{{ t('git.identity.name') }}</span>
          <input
            v-model="name"
            class="ginit-input"
            :placeholder="t('git.identity.namePlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
        <label class="ginit-field">
          <span class="ginit-label">{{ t('git.identity.email') }}</span>
          <input
            v-model="email"
            class="ginit-input mono"
            :placeholder="t('git.identity.emailPlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
      </div>

      <div class="ginit-actions">
        <button class="btn pri" :disabled="busy" @click="onInit">
          <Icon v-if="!busy" name="plus" style="width: 14px; height: 14px" />
          {{ busy ? t('git.init.initializing') : t('git.init.button') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// NO_REPO empty state — shown by GitManager when the selected workspace exists but
// has no .git. Offers `git init` plus an inline commit-identity form (name/email)
// so a fresh repo can commit immediately. Identity is written to the global config
// (~/.gitconfig) — git config --global doesn't need a repo, so it can run pre-init.
import { useGitStore } from '~/stores/git'

const { t } = useI18n()
const store = useGitStore()

const name = ref('')
const email = ref('')
const busy = ref(false)
const loadedName = ref('')
const loadedEmail = ref('')

const projectPath = computed(
  () => store.projects.find((p) => p.id === store.currentProjectId)?.path ?? '',
)

onMounted(async () => {
  const id = await store.loadIdentity()
  loadedName.value = id?.global.name ?? ''
  loadedEmail.value = id?.global.email ?? ''
  name.value = loadedName.value
  email.value = loadedEmail.value
})

async function onInit() {
  if (busy.value) return
  busy.value = true
  try {
    // Persist identity first (works without a repo) so the new repo is commit-ready.
    const n = name.value.trim()
    const e = email.value.trim()
    if (n && e && (n !== loadedName.value || e !== loadedEmail.value)) {
      await store.saveIdentity({ scope: 'global', name: n, email: e })
    }
    await store.gitInit()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ginit {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  overflow-y: auto;
}
.ginit-card {
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 24px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.ginit-icon {
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--r-card);
  background: var(--bgInput);
  border: 1px solid var(--border);
  margin-bottom: 2px;
}
.ginit-title {
  text-align: center;
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.ginit-path {
  text-align: center;
  font-size: 12px;
  color: var(--textDim);
}
.ginit-desc {
  text-align: center;
  font-size: 1em;
  line-height: 1.5;
  color: var(--textDim);
  margin: 2px 0 8px;
}
.ginit-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.ginit-sec-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ginit-sec-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.ginit-hint {
  font-size: 1em;
  color: var(--textDim);
  margin: -2px 0 2px;
}
.ginit-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ginit-label {
  flex: none;
  width: 48px;
  font-size: 1em;
  font-weight: 500;
  color: var(--textDim);
}
.ginit-input {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.ginit-input.mono {
  font-family: var(--mono);
}
.ginit-input:focus {
  border-color: var(--accent);
}
.ginit-input:disabled {
  opacity: 0.55;
}
.ginit-actions {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}
.ginit-actions .btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
