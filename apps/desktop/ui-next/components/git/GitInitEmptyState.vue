<template>
  <div class="ginit">
    <div class="ginit-card">
      <div class="ginit-icon">
        <Icon name="git" class="size-6 text-primary" />
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
          <Icon name="globe" class="size-3.5 text-muted-foreground" />
          <span class="ginit-sec-title">{{ t('git.init.identityTitle') }}</span>
        </div>
        <p class="ginit-hint">{{ t('git.init.identityHint') }}</p>
        <label class="ginit-field">
          <span class="ginit-label">{{ t('git.identity.name') }}</span>
          <Input
            v-model="name"
            :placeholder="t('git.identity.namePlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
        <label class="ginit-field">
          <span class="ginit-label">{{ t('git.identity.email') }}</span>
          <Input
            v-model="email"
            class="font-mono"
            :placeholder="t('git.identity.emailPlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
      </div>

      <div class="ginit-actions">
        <Button :disabled="busy" @click="onInit">
          <Icon v-if="!busy" name="plus" class="size-3.5" />
          {{ busy ? t('git.init.initializing') : t('git.init.button') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// NO_REPO empty state — shown by GitManager when the selected workspace exists but
// has no .git. Offers `git init` plus an inline commit-identity form (name/email)
// so a fresh repo can commit immediately. Identity is written to the global config
// (~/.gitconfig) — git config --global doesn't need a repo, so it can run pre-init.
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-sm);
}
.ginit-icon {
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--r-card);
  background: var(--muted);
  border: 1px solid var(--border);
  margin-bottom: 2px;
}
.ginit-title {
  text-align: center;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.ginit-path {
  text-align: center;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
}
.ginit-desc {
  text-align: center;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--muted-foreground);
  margin: 2px 0 8px;
}
.ginit-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.ginit-sec-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ginit-sec-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.ginit-hint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
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
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--muted-foreground);
}
.ginit-actions {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}
</style>
