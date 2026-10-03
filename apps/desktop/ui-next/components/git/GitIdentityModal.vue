<template>
  <Dialog :open="open" @update:open="(v) => !v && close()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('git.identity.title') }}</DialogTitle>
        <DialogDescription>{{ t('git.identity.subtitle') }}</DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('git.identity.loading') }}
      </div>

      <div v-else class="grid gap-4">
        <!-- Effective identity recorded on commits (local overrides global) -->
        <div
          class="flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          :class="hasEffective ? 'text-muted-foreground' : 'text-warning'"
        >
          <Icon name="commit" class="size-3.5 shrink-0" />
          <span v-if="hasEffective" class="truncate font-mono">
            {{ t('git.identity.effective') }}: {{ effectiveName }} &lt;{{ effectiveEmail }}&gt;
          </span>
          <span v-else>{{ t('git.identity.none') }}</span>
        </div>

        <!-- Global scope -->
        <section class="grid gap-2">
          <div class="flex items-center gap-1.5">
            <Icon name="globe" class="size-3.5 text-muted-foreground" />
            <span class="text-sm font-semibold">{{ t('git.identity.globalTitle') }}</span>
          </div>
          <p class="text-sm text-muted-foreground">{{ t('git.identity.globalHint') }}</p>
          <label class="grid grid-cols-[52px_1fr] items-center gap-3">
            <span class="text-sm font-medium text-muted-foreground">
              {{ t('git.identity.name') }}
            </span>
            <Input v-model="gName" :placeholder="t('git.identity.namePlaceholder')" />
          </label>
          <label class="grid grid-cols-[52px_1fr] items-center gap-3">
            <span class="text-sm font-medium text-muted-foreground">
              {{ t('git.identity.email') }}
            </span>
            <Input
              v-model="gEmail"
              class="font-mono"
              :placeholder="t('git.identity.emailPlaceholder')"
            />
          </label>
        </section>

        <!-- Project (repo-local) scope -->
        <section class="grid gap-2">
          <div class="flex items-center gap-1.5">
            <Icon name="projects" class="size-3.5 text-muted-foreground" />
            <span class="truncate text-sm font-semibold">
              {{ t('git.identity.projectTitle') }}
              <span v-if="projectName" class="font-medium text-muted-foreground">
                · {{ projectName }}
              </span>
            </span>
          </div>
          <p class="text-sm text-muted-foreground">
            {{ t('git.identity.projectHint', { project: projectName || '—' }) }}
          </p>
          <label class="grid grid-cols-[52px_1fr] items-center gap-3">
            <span class="text-sm font-medium text-muted-foreground">
              {{ t('git.identity.name') }}
            </span>
            <Input v-model="pName" :placeholder="gName || t('git.identity.inheritEmpty')" />
          </label>
          <label class="grid grid-cols-[52px_1fr] items-center gap-3">
            <span class="text-sm font-medium text-muted-foreground">
              {{ t('git.identity.email') }}
            </span>
            <Input
              v-model="pEmail"
              class="font-mono"
              :placeholder="gEmail || t('git.identity.inheritEmpty')"
            />
          </label>
        </section>
      </div>

      <DialogFooter class="items-center">
        <span v-if="error" class="mr-auto text-sm text-destructive">{{ error }}</span>
        <span v-else-if="savedFlash" class="mr-auto text-sm text-success">
          ✓ {{ t('git.identity.saved') }}
        </span>
        <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSave" @click="onSave">
          {{ saving ? '…' : t('git.identity.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Git Identity modal — view/edit user.name + user.email at the global
// (~/.gitconfig) and repo-local scopes for the project currently selected in the
// Git page. A git-domain modal: it owns its form state and drives the git store
// (loadIdentity / saveIdentity) directly. Save writes only the scope(s) whose
// fields changed; clearing a project field unsets the local override (inherit).
import type { GitIdentity } from '~/composables/useGitApi'
import { useGitStore } from '~/stores/git'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const store = useGitStore()

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const savedFlash = ref(false)
const loaded = ref<GitIdentity | null>(null)

const gName = ref('')
const gEmail = ref('')
const pName = ref('')
const pEmail = ref('')

const projectName = computed(
  () => store.projects.find((p) => p.id === store.currentProjectId)?.name ?? '',
)

// Effective identity recorded on commits: a local override wins over global.
const effectiveName = computed(() => pName.value.trim() || gName.value.trim())
const effectiveEmail = computed(() => pEmail.value.trim() || gEmail.value.trim())
const hasEffective = computed(() => !!effectiveName.value && !!effectiveEmail.value)

const globalChanged = computed(
  () =>
    gName.value.trim() !== (loaded.value?.global.name ?? '') ||
    gEmail.value.trim() !== (loaded.value?.global.email ?? ''),
)
const localChanged = computed(
  () =>
    pName.value.trim() !== (loaded.value?.local.name ?? '') ||
    pEmail.value.trim() !== (loaded.value?.local.email ?? ''),
)
const canSave = computed(() => !saving.value && (globalChanged.value || localChanged.value))

function seed(id: GitIdentity | null) {
  loaded.value = id
  gName.value = id?.global.name ?? ''
  gEmail.value = id?.global.email ?? ''
  pName.value = id?.local.name ?? ''
  pEmail.value = id?.local.email ?? ''
}

async function load() {
  loading.value = true
  error.value = ''
  savedFlash.value = false
  try {
    seed(await store.loadIdentity())
  } finally {
    loading.value = false
  }
}

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  savedFlash.value = false
  try {
    if (globalChanged.value) {
      const ok = await store.saveIdentity({
        scope: 'global',
        name: gName.value.trim(),
        email: gEmail.value.trim(),
      })
      if (!ok) {
        error.value = t('git.identity.error')
        return
      }
    }
    if (localChanged.value) {
      const ok = await store.saveIdentity({
        scope: 'local',
        name: pName.value.trim(),
        email: pEmail.value.trim(),
      })
      if (!ok) {
        error.value = t('git.identity.error')
        return
      }
    }
    savedFlash.value = true
    // Re-read so the baseline (and inherited placeholders) reflect what git stored.
    if (store.available) seed(await store.loadIdentity())
    else
      seed({
        global: { name: gName.value, email: gEmail.value },
        local: { name: pName.value || null, email: pEmail.value || null },
      })
  } finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load()
  },
)
</script>
