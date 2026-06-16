<template>
  <BaseModal :open="open" :title="tr('git.push_dialog.title')" size="sm" @close="emit('close')">
    <div class="p-4 flex flex-col gap-4 text-[1em]">
      <div class="flex items-start gap-2.5">
        <ArrowUpFromLine :size="16" class="flex-shrink-0 mt-0.5" :style="{ color: t.accent }" />
        <span :style="{ color: t.textMuted }">{{ tr('git.push_dialog.subtitle') }}</span>
      </div>

      <!-- Branch (current checked-out branch — read-only) -->
      <div class="flex items-center gap-3">
        <span class="w-14 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.push_dialog.branch_label') }}
        </span>
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 rounded min-w-0 flex-1"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <GitBranchIcon :size="13" class="flex-shrink-0" :style="{ color: t.textDim }" />
          <span class="font-mono truncate" :style="{ color: t.text }">{{ currentBranch }}</span>
        </div>
      </div>

      <!-- To (target remote branch — remote + branch combined, like Fork) -->
      <div class="flex items-center gap-3">
        <span class="w-14 flex-shrink-0 text-right" :style="{ color: t.textDim }">
          {{ tr('git.push_dialog.to_label') }}
        </span>
        <div class="flex-1 min-w-0">
          <AppSelect v-model="selectedTarget" mono :disabled="targetOptions.length === 0">
            <option v-if="targetOptions.length === 0" value="">
              {{ tr('git.push_dialog.no_remote') }}
            </option>
            <option v-for="opt in targetOptions" :key="opt.value" :value="opt.value">
              {{ opt.value }}{{ opt.isNew ? tr('git.push_dialog.new_branch_suffix') : '' }}
            </option>
          </AppSelect>
        </div>
      </div>

      <!-- Upstream / ahead hints -->
      <div class="flex flex-col gap-1 pl-[4.25rem] -mt-2">
        <span
          v-if="needsUpstream && selectedTarget"
          class="text-[12px]"
          :style="{ color: t.warning }"
        >
          {{ tr('git.push_dialog.set_upstream_hint', { target: selectedTarget }) }}
        </span>
        <span v-else-if="ahead > 0" class="text-[12px]" :style="{ color: t.textFaint }">
          {{ tr('git.push_dialog.ahead_summary', { count: ahead }) }}
        </span>
      </div>

      <div class="h-px" :style="{ background: t.border }" />

      <!-- Push all tags. The whole row toggles; AppToggle is display-only here
           (its own button click bubbles to this handler) so the click fires
           exactly once — a nested <button> would double-toggle and cancel out. -->
      <div
        class="flex items-center justify-between gap-3 text-left cursor-pointer select-none"
        @click="pushTags = !pushTags"
      >
        <span :style="{ color: t.text }">{{ tr('git.push_dialog.push_tags') }}</span>
        <AppToggle :model-value="pushTags" />
      </div>

      <!-- Force push -->
      <div class="flex flex-col gap-1">
        <div
          class="flex items-center justify-between gap-3 text-left cursor-pointer select-none"
          @click="force = !force"
        >
          <span :style="{ color: force ? t.danger : t.text }">
            {{ tr('git.push_dialog.force') }}
          </span>
          <AppToggle :model-value="force" />
        </div>
        <span v-if="force" class="text-[12px]" :style="{ color: t.danger }">
          {{ tr('git.push_dialog.force_hint') }}
        </span>
      </div>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton :variant="force ? 'danger' : 'default'" :disabled="!canPush" @click="onPush">
        {{ tr('git.push_dialog.submit') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ArrowUpFromLine, GitBranch as GitBranchIcon } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const currentBranch = computed(() => store.currentBranch ?? '')
const ahead = computed(() => store.ahead)
const remoteNames = computed(() => store.remotes.map((r) => r.name))
const needsUpstream = computed(() => !store.currentBranchInfo?.upstream)

// Existing remote-tracking branches as full refs (`origin/main`, …).
const remoteBranches = computed(() => store.branches.filter((b) => b.isRemote).map((b) => b.name))

// Split a remote ref into its remote + branch by matching a known remote-name
// prefix — branch names contain slashes, so splitting on the first `/` is wrong.
const parseRef = (ref: string): { remote: string; branch: string } | null => {
  const remote = remoteNames.value.find((n) => ref === n || ref.startsWith(`${n}/`))
  if (!remote) return null
  const branch = ref.slice(remote.length + 1)
  return branch ? { remote, branch } : null
}

type TargetOption = { value: string; remote: string; branch: string; isNew: boolean }

// "To" options = the natural same-name target per remote (may be a new branch),
// plus every existing remote branch. This lets the user retarget the push to a
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
    const value = `${remote}/${currentBranch.value}`
    add(value, !remoteBranches.value.includes(value))
  }
  for (const ref of [...remoteBranches.value].sort()) add(ref, false)
  return opts
})

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
  (open) => {
    if (!open) return
    const upstream = store.currentBranchInfo?.upstream
    const fallback = remoteNames.value[0] ? `${remoteNames.value[0]}/${currentBranch.value}` : ''
    selectedTarget.value =
      upstream && targetOptions.value.some((o) => o.value === upstream)
        ? upstream
        : (targetOptions.value[0]?.value ?? fallback)
    pushTags.value = false
    force.value = false
  },
  { immediate: true },
)

const canPush = computed(() => !store.isPushing && selectedParsed.value !== null)

const onPush = () => {
  const target = selectedParsed.value
  if (!canPush.value || !target) return
  store.push({
    remote: target.remote,
    branch: currentBranch.value,
    targetBranch: target.branch,
    pushTags: pushTags.value,
    force: force.value,
    setUpstream: needsUpstream.value,
  })
}
</script>
