<template>
  <Teleport to="body">
    <div v-if="open" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card gpm-push" role="dialog" aria-modal="true">
        <div class="gpm-title">{{ t('git.pushDialog.title') }}</div>

        <div class="gpm-lead">
          <Icon name="commit" class="gpm-leadicn" />
          <span>{{ t('git.pushDialog.subtitle') }}</span>
        </div>

        <!-- Branch (current checked-out branch — read-only) -->
        <label class="gbc-field">
          <span class="gbc-label">{{ t('git.pushDialog.branchLabel') }}</span>
          <div class="gpm-ro mono">
            <Icon name="branch" class="gpm-roicn" />
            <span class="gtrunc">{{ currentBranch }}</span>
          </div>
        </label>

        <!-- To (target remote branch — remote + branch combined, like Fork) -->
        <label class="gbc-field">
          <span class="gbc-label">{{ t('git.pushDialog.toLabel') }}</span>
          <AppSelect
            v-if="selectOptions.length"
            v-model="selectedTarget"
            :options="selectOptions"
            width="100%"
          />
          <span v-else class="gbc-nobase">{{ t('git.pushDialog.noRemote') }}</span>
        </label>

        <!-- Upstream / ahead hints -->
        <div v-if="needsUpstream && selectedTarget" class="gpm-hint warn">
          {{ t('git.pushDialog.setUpstreamHint', { target: selectedTarget }) }}
        </div>
        <div v-else-if="ahead > 0" class="gpm-hint">
          {{ t('git.pushDialog.aheadSummary', { count: ahead }) }}
        </div>

        <div class="gpm-sep" />

        <!-- Push all tags -->
        <div class="gpm-toggle" @click="pushTags = !pushTags">
          <span>{{ t('git.pushDialog.pushTags') }}</span>
          <span class="tog2 sm" :class="{ off: !pushTags }" />
        </div>

        <!-- Force push -->
        <div class="gpm-toggle" @click="force = !force">
          <span :style="force ? { color: 'var(--danger)' } : undefined">
            {{ t('git.pushDialog.force') }}
          </span>
          <span class="tog2 sm" :class="{ off: !force }" />
        </div>
        <div v-if="force" class="gpm-hint danger">{{ t('git.pushDialog.forceHint') }}</div>

        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button
            class="btn pri"
            :class="{ 'gpm-dangerbtn': force }"
            :disabled="!canPush"
            @click="submit"
          >
            {{ t('git.pushDialog.submit') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Push options modal — pick the target remote/branch, toggle push-all-tags and
// force (--force-with-lease), and set-upstream when the branch isn't tracked yet.
// Prop-driven (no store import) like GitBranchCreateModal; emits the resolved
// PushParams so GitManager can call store.push(). Mirrors production
// apps/desktop/ui/components/git/GitPushModal.vue.
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { PushParams } from '~/composables/useGitApi'
import type { BranchInfo, RemoteInfo } from './git-types'

const props = defineProps<{
  open: boolean
  currentBranch: string
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  ahead: number
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', params: PushParams): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const remoteNames = computed(() => props.remotes.map((r) => r.name))
const currentBranchInfo = computed(() => props.branches.find((b) => b.current && !b.remote) ?? null)
const needsUpstream = computed(() => !currentBranchInfo.value?.upstream)

// Existing remote-tracking branches as full refs (`origin/main`, …).
const remoteBranches = computed(() => props.branches.filter((b) => b.remote).map((b) => b.name))

// Split a remote ref into its remote + branch by matching a known remote-name
// prefix — branch names contain slashes, so splitting on the first `/` is wrong.
function parseRef(ref: string): { remote: string; branch: string } | null {
  const remote = remoteNames.value.find((n) => ref === n || ref.startsWith(`${n}/`))
  if (!remote) return null
  const branch = ref.slice(remote.length + 1)
  return branch ? { remote, branch } : null
}

type TargetOption = { value: string; remote: string; branch: string; isNew: boolean }

// "To" options = the natural same-name target per remote (may be a new branch),
// plus every existing remote branch. Lets the user retarget the push to a
// differently-named remote branch (Fork-style combined remote/branch picker).
const targetOptions = computed<TargetOption[]>(() => {
  const seen = new Set<string>()
  const opts: TargetOption[] = []
  const add = (value: string, isNew: boolean) => {
    if (seen.has(value)) return
    const parsed = parseRef(value)
    if (!parsed) return
    seen.add(value)
    opts.push({ value, ...parsed, isNew })
  }
  for (const remote of remoteNames.value) {
    const value = `${remote}/${props.currentBranch}`
    add(value, !remoteBranches.value.includes(value))
  }
  for (const ref of [...remoteBranches.value].sort()) add(ref, false)
  return opts
})

const selectOptions = computed<AppSelectOption[]>(() =>
  targetOptions.value.map((o) => ({
    value: o.value,
    label: o.value + (o.isNew ? t('git.pushDialog.newBranchSuffix') : ''),
  })),
)

const selectedTarget = ref('')
const pushTags = ref(false)
const force = ref(false)

const selectedParsed = computed(
  () => targetOptions.value.find((o) => o.value === selectedTarget.value) ?? null,
)

// Re-seed each time the dialog opens: prefer the tracked upstream, else the
// current branch's same-name target on the first remote. Empty when the repo
// has no remote at all → Push stays disabled.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const upstream = currentBranchInfo.value?.upstream
    selectedTarget.value =
      upstream && targetOptions.value.some((o) => o.value === upstream)
        ? upstream
        : (targetOptions.value[0]?.value ?? '')
    pushTags.value = false
    force.value = false
  },
  { immediate: true },
)

const canPush = computed(() => !props.busy && selectedParsed.value !== null)

function submit() {
  const target = selectedParsed.value
  if (!canPush.value || !target) return
  emit('submit', {
    remote: target.remote,
    branch: props.currentBranch,
    targetBranch: target.branch,
    pushTags: pushTags.value,
    force: force.value,
    setUpstream: needsUpstream.value,
  })
}
</script>

<style scoped>
/* Overlay + card mirror GitBranchCreateModal (.gpm-*) for a consistent git-modal
   look; push-specific rows (lead / read-only branch / toggles / hints) below. */
.gpm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.gpm-card {
  width: 440px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gpm-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gpm-lead {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 1em;
  color: var(--textMuted);
}
.gpm-leadicn {
  width: 15px;
  height: 15px;
  margin-top: 2px;
  flex: none;
  color: var(--accent);
}
.gbc-field {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gbc-label {
  flex: none;
  width: 56px;
  font-size: 1em;
  font-weight: 500;
  color: var(--textDim);
}
.gbc-nobase {
  flex: 1;
  font-size: 1em;
  color: var(--textDim);
  font-style: italic;
}
.gpm-ro {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-size: 1em;
}
.gpm-ro.mono {
  font-family: var(--mono);
}
.gpm-roicn {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--textDim);
}
.gtrunc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gpm-hint {
  margin-top: -6px;
  padding-left: 66px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.gpm-hint.warn {
  color: var(--amber);
}
.gpm-hint.danger {
  color: var(--danger);
  padding-left: 0;
  margin-top: -8px;
}
.gpm-sep {
  height: 1px;
  background: var(--border);
}
.gpm-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 1em;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}
.gpm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
.gpm-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.gpm-dangerbtn {
  background: var(--danger);
}
</style>
