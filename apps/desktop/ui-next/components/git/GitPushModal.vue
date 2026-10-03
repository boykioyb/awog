<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('git.pushDialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('git.pushDialog.subtitle') }}</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <!-- Branch (current checked-out branch — read-only) -->
        <label class="grid grid-cols-[56px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">
            {{ t('git.pushDialog.branchLabel') }}
          </span>
          <div
            class="flex h-[var(--ctrl-h)] min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-sm"
          >
            <Icon name="branch" class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ currentBranch }}</span>
          </div>
        </label>

        <!-- To (target remote branch — remote + branch combined, like Fork) -->
        <label class="grid grid-cols-[56px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">
            {{ t('git.pushDialog.toLabel') }}
          </span>
          <AppSelect
            v-if="selectOptions.length"
            v-model="selectedTarget"
            :options="selectOptions"
            width="100%"
          />
          <span v-else class="text-sm italic text-muted-foreground">
            {{ t('git.pushDialog.noRemote') }}
          </span>
        </label>

        <!-- Upstream / ahead hints -->
        <div v-if="needsUpstream && selectedTarget" class="pl-[68px] text-sm text-warning">
          {{ t('git.pushDialog.setUpstreamHint', { target: selectedTarget }) }}
        </div>
        <div v-else-if="ahead > 0" class="pl-[68px] text-sm text-muted-foreground">
          {{ t('git.pushDialog.aheadSummary', { count: ahead }) }}
        </div>

        <Separator />

        <!-- Push all tags -->
        <div
          class="flex cursor-pointer select-none items-center justify-between gap-3 text-sm"
          @click="pushTags = !pushTags"
        >
          <span>{{ t('git.pushDialog.pushTags') }}</span>
          <Switch :checked="pushTags" @click.stop @update:checked="pushTags = $event" />
        </div>

        <!-- Force push -->
        <div
          class="flex cursor-pointer select-none items-center justify-between gap-3 text-sm"
          @click="force = !force"
        >
          <span :class="force ? 'text-destructive' : undefined">
            {{ t('git.pushDialog.force') }}
          </span>
          <Switch
            :checked="force"
            class="data-[state=checked]:bg-destructive"
            @click.stop
            @update:checked="force = $event"
          />
        </div>
        <div v-if="force" class="text-sm text-destructive">{{ t('git.pushDialog.forceHint') }}</div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button :variant="force ? 'destructive' : 'default'" :disabled="!canPush" @click="submit">
          {{ t('git.pushDialog.submit') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Push options modal — pick the target remote/branch, toggle push-all-tags and
// force (--force-with-lease), and set-upstream when the branch isn't tracked yet.
// Prop-driven (no store import) like GitBranchCreateModal; emits the resolved
// PushParams so GitManager can call store.push(). Mirrors production
// apps/desktop/ui/components/git/GitPushModal.vue.
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Separator from '~/components/ui/separator/Separator.vue'
import Switch from '~/components/ui/switch/Switch.vue'
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
