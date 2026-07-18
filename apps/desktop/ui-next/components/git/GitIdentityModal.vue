<template>
  <Teleport to="body">
    <div v-if="open" class="gid-ovl" @click.self="close">
      <div class="gid-card" role="dialog" aria-modal="true">
        <div class="gid-head">
          <Icon name="settings" style="width: 15px; height: 15px; color: var(--textDim)" />
          <div class="gid-titles">
            <div class="gid-title">{{ t('git.identity.title') }}</div>
            <div class="gid-sub">{{ t('git.identity.subtitle') }}</div>
          </div>
          <button class="gid-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div v-if="loading" class="gid-loading">{{ t('git.identity.loading') }}</div>

        <template v-else>
          <!-- Effective identity recorded on commits (local overrides global) -->
          <div class="gid-eff" :style="hasEffective ? undefined : { color: 'var(--amber)' }">
            <Icon name="commit" style="width: 13px; height: 13px; flex: none" />
            <span v-if="hasEffective" class="mono gtrunc">
              {{ t('git.identity.effective') }}: {{ effectiveName }} &lt;{{ effectiveEmail }}&gt;
            </span>
            <span v-else>{{ t('git.identity.none') }}</span>
          </div>

          <!-- Global scope -->
          <section class="gid-sec">
            <div class="gid-sec-head">
              <Icon name="globe" style="width: 13px; height: 13px; color: var(--textDim)" />
              <span class="gid-sec-title">{{ t('git.identity.globalTitle') }}</span>
            </div>
            <p class="gid-hint">{{ t('git.identity.globalHint') }}</p>
            <label class="gid-field">
              <span class="gid-label">{{ t('git.identity.name') }}</span>
              <input
                v-model="gName"
                class="gid-input"
                :placeholder="t('git.identity.namePlaceholder')"
                @keydown.esc.prevent="close"
              />
            </label>
            <label class="gid-field">
              <span class="gid-label">{{ t('git.identity.email') }}</span>
              <input
                v-model="gEmail"
                class="gid-input mono"
                :placeholder="t('git.identity.emailPlaceholder')"
                @keydown.esc.prevent="close"
              />
            </label>
          </section>

          <!-- Project (repo-local) scope -->
          <section class="gid-sec">
            <div class="gid-sec-head">
              <Icon name="projects" style="width: 13px; height: 13px; color: var(--textDim)" />
              <span class="gid-sec-title gtrunc">
                {{ t('git.identity.projectTitle') }}
                <span v-if="projectName" class="gid-proj">· {{ projectName }}</span>
              </span>
            </div>
            <p class="gid-hint">
              {{ t('git.identity.projectHint', { project: projectName || '—' }) }}
            </p>
            <label class="gid-field">
              <span class="gid-label">{{ t('git.identity.name') }}</span>
              <input
                v-model="pName"
                class="gid-input"
                :placeholder="gName || t('git.identity.inheritEmpty')"
                @keydown.esc.prevent="close"
              />
            </label>
            <label class="gid-field">
              <span class="gid-label">{{ t('git.identity.email') }}</span>
              <input
                v-model="pEmail"
                class="gid-input mono"
                :placeholder="gEmail || t('git.identity.inheritEmpty')"
                @keydown.esc.prevent="close"
              />
            </label>
          </section>

          <div class="gid-foot">
            <span v-if="error" class="gid-msg" :style="{ color: 'var(--danger)' }">
              {{ error }}
            </span>
            <span v-else-if="savedFlash" class="gid-msg" :style="{ color: 'var(--green)' }">
              ✓ {{ t('git.identity.saved') }}
            </span>
            <span style="flex: 1" />
            <button class="btn" @click="close">{{ t('common.cancel') }}</button>
            <button class="btn pri" :disabled="!canSave" @click="onSave">
              {{ saving ? '…' : t('git.identity.save') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Git Identity modal — view/edit user.name + user.email at the global
// (~/.gitconfig) and repo-local scopes for the project currently selected in the
// Git page. A git-domain modal: it owns its form state and drives the git store
// (loadIdentity / saveIdentity) directly. Save writes only the scope(s) whose
// fields changed; clearing a project field unsets the local override (inherit).
import type { GitIdentity } from '~/composables/useGitApi'
import { useGitStore } from '~/stores/git'

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

<style scoped>
.gid-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 24px;
}
.gid-card {
  width: 440px;
  max-width: 94vw;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gid-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.gid-titles {
  flex: 1;
  min-width: 0;
}
.gid-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gid-sub {
  font-size: 1em;
  color: var(--textDim);
  margin-top: 2px;
}
.gid-x {
  flex: none;
  padding: 4px;
  border-radius: 6px;
  color: var(--textDim);
  transition: background 0.12s;
}
.gid-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.gid-loading {
  padding: 24px 0;
  text-align: center;
  color: var(--textDim);
}
.gid-eff {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: 1em;
}
.gid-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gid-sec-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.gid-sec-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gid-proj {
  font-weight: 500;
  color: var(--textDim);
}
.gid-hint {
  font-size: 1em;
  color: var(--textDim);
  margin: -2px 0 2px;
}
.gid-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gid-label {
  flex: none;
  width: 52px;
  font-size: 1em;
  font-weight: 500;
  color: var(--textDim);
}
.gid-input {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.gid-input.mono {
  font-family: var(--mono);
}
.gid-input:focus {
  border-color: var(--accent);
}
.gid-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.gid-msg {
  font-size: 1em;
}
.gid-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
