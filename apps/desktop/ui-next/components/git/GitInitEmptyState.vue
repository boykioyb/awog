<template>
  <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
    <Card class="w-full max-w-110 gap-2.5 rounded-xl p-6">
      <div
        class="mb-0.5 flex size-13 items-center justify-center self-center rounded-xl border bg-muted"
      >
        <Icon name="git" class="size-6 text-primary" />
      </div>

      <div class="text-center text-base font-semibold">{{ t('git.init.title') }}</div>
      <!-- mono-ok: đường dẫn project -->
      <div
        v-if="projectPath"
        class="truncate text-center font-mono text-xs text-muted-foreground"
        :title="projectPath"
      >
        {{ projectPath }}
      </div>
      <p class="mt-0.5 mb-2 text-center text-base text-muted-foreground">
        {{ t('git.init.desc') }}
      </p>

      <!-- Commit identity — git refuses to commit without user.name / user.email.
           Prefilled from the global config; saved to ~/.gitconfig on init. -->
      <div class="flex flex-col gap-2 rounded-lg border bg-muted p-3">
        <div class="flex items-center gap-2">
          <Icon name="globe" class="size-3.5 text-muted-foreground" />
          <span class="text-sm font-semibold">{{ t('git.init.identityTitle') }}</span>
        </div>
        <p class="-mt-0.5 mb-0.5 text-sm text-muted-foreground">{{ t('git.init.identityHint') }}</p>
        <label class="flex items-center gap-2.5">
          <span class="w-12 flex-none text-sm font-medium text-muted-foreground">
            {{ t('git.identity.name') }}
          </span>
          <Input
            v-model="name"
            :placeholder="t('git.identity.namePlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
        <label class="flex items-center gap-2.5">
          <span class="w-12 flex-none text-sm font-medium text-muted-foreground">
            {{ t('git.identity.email') }}
          </span>
          <Input
            v-model="email"
            class="font-mono"
            :placeholder="t('git.identity.emailPlaceholder')"
            :disabled="busy"
            @keydown.enter.prevent="onInit"
          />
        </label>
      </div>

      <div class="mt-1 flex justify-center">
        <Button :disabled="busy" @click="onInit">
          <Icon v-if="!busy" name="plus" class="size-3.5" />
          {{ busy ? t('git.init.initializing') : t('git.init.button') }}
        </Button>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
// NO_REPO empty state — shown by GitManager when the selected workspace exists but
// has no .git. Offers `git init` plus an inline commit-identity form (name/email)
// so a fresh repo can commit immediately. Identity is written to the global config
// (~/.gitconfig) — git config --global doesn't need a repo, so it can run pre-init.
import Button from '~/components/ui/button/Button.vue'
import Card from '~/components/ui/card/Card.vue'
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
