<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <div
        class="grid size-6.5 flex-none place-items-center rounded-sm border bg-muted text-muted-foreground"
      >
        <Icon name="zap" class="size-3.5" />
      </div>
      <div class="min-w-0 truncate text-lg font-semibold">{{ hook.name }}</div>
      <!-- mono-ok: tên event hook -->
      <Badge variant="outline" class="font-mono text-muted-foreground">{{ hook.event }}</Badge>
      <Badge variant="outline" :class="hook.runMode === 'blocking' ? TAG_ACC : TAG">
        {{ hook.runMode }}
      </Badge>
      <Badge variant="outline" :class="isProject ? TAG_ACC : TAG">{{ sourceLabel }}</Badge>
      <Badge v-if="isImported" variant="outline" :class="TAG">
        <Icon name="shield" />
        {{ t('hooks.detail.imported') }}
      </Badge>
      <span class="flex-1" />
      <Button
        v-if="!isImported"
        :title="t('hooks.detail.runOnce')"
        :disabled="running"
        variant="outline"
        size="iconSm"
        @click="emit('run')"
      >
        <Icon :name="running ? 'refresh' : 'play'" :class="{ 'animate-spin': running }" />
      </Button>
      <Button :title="t('hooks.detail.edit')" variant="outline" size="iconSm" @click="emit('edit')">
        <Icon name="edit" />
      </Button>
      <Button
        v-if="!isImported"
        :title="t('hooks.detail.delete')"
        class="hover:border-destructive hover:text-destructive"
        variant="outline"
        size="iconSm"
        @click="emit('delete')"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto p-5.5">
      <p class="m-0 text-base leading-(--lh-prose) text-muted-foreground">{{ hook.description }}</p>

      <!-- Trust gate (ADR 0032 D-8): a project-tier hook must be explicitly
           trusted before it can spawn. -->
      <div
        v-if="needsTrust"
        class="mt-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3"
      >
        <Icon name="alert" class="mt-0.5 size-4 flex-none text-warning" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="text-base font-semibold text-warning">{{ t('hooks.trust.title') }}</div>
          <div class="text-sm text-muted-foreground">{{ t('hooks.trust.desc') }}</div>
          <Button class="mt-1.5 self-start" variant="outline" size="sm" @click="emit('trust')">
            <Icon name="shield" />
            {{ t('hooks.trust.button') }}
          </Button>
        </div>
      </div>

      <!-- Quick controls -->
      <div class="mt-4 grid grid-cols-3 gap-2.5">
        <div :class="CTL">
          <span :class="CTL_LABEL">{{ t('hooks.detail.enabled') }}</span>
          <Switch
            class="self-start"
            :checked="hook.enabled"
            :disabled="isImported"
            :title="t('hooks.detail.toggleHint')"
            :aria-label="t('hooks.detail.enabled')"
            @update:checked="emit('toggle')"
          />
        </div>
        <div :class="CTL">
          <span :class="CTL_LABEL">{{ t('hooks.detail.runMode') }}</span>
          <!-- mono-ok: giá trị cấu hình runMode -->
          <span class="font-mono text-sm text-foreground">{{ hook.runMode }}</span>
        </div>
        <div :class="CTL">
          <span :class="CTL_LABEL">{{ t('hooks.detail.timeout') }}</span>
          <span class="tnum text-sm text-foreground">{{ hook.timeoutMs }}ms</span>
        </div>
      </div>

      <!-- Matcher -->
      <div :class="SECH">{{ t('hooks.detail.matcher') }}</div>
      <div v-if="matcherEntries.length === 0" class="text-sm text-faint">
        {{ t('hooks.detail.matcherEmpty') }}
      </div>
      <div v-else class="flex flex-col gap-2">
        <!-- mono-ok: khoá/giá trị matcher -->
        <div v-for="[k, v] in matcherEntries" :key="k" :class="KV">
          <span class="flex-none font-mono text-sm text-dim">{{ k }}</span>
          <span class="break-all font-mono text-sm text-foreground">{{ v }}</span>
        </div>
      </div>

      <!-- Command -->
      <div :class="SECH">{{ t('hooks.detail.command') }}</div>
      <!-- mono-ok: lệnh shell của hook -->
      <pre
        class="m-0 whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 font-mono text-sm leading-(--lh-prose) text-muted-foreground"
        >{{ hook.command }}</pre
      >
      <div class="mt-2.5 flex flex-col gap-2">
        <div :class="KV">
          <span class="flex-none text-sm text-dim">{{ t('hooks.detail.cwd') }}</span>
          <!-- mono-ok: đường dẫn cwd -->
          <span class="break-all font-mono text-sm text-foreground">{{ hook.cwd }}</span>
        </div>
        <div :class="KV">
          <span class="flex-none text-sm text-dim">{{ t('hooks.detail.env') }}</span>
          <span class="break-all text-sm text-foreground">
            {{ t('hooks.detail.envCount', { count: envCount }) }}
          </span>
        </div>
      </div>

      <!-- Recent runs -->
      <div :class="SECH">
        {{ t('hooks.detail.recentRuns', { count: hook.recentRuns.length }) }}
      </div>
      <div v-if="hook.recentRuns.length === 0" class="text-sm text-faint">
        {{ t('hooks.detail.noRuns') }}
      </div>
      <div v-else class="flex flex-col gap-1.5">
        <div v-for="(run, i) in hook.recentRuns" :key="i" :class="[KV, 'flex-wrap gap-3']">
          <span
            class="size-1.5 flex-none rounded-full"
            :class="run.exitCode === 0 ? 'bg-success' : 'bg-destructive'"
          />
          <!-- mono-ok: exit code -->
          <span class="min-w-14 font-mono text-sm text-foreground">
            {{ run.exitCode === 0 ? 'OK' : `EXIT ${run.exitCode}` }}
          </span>
          <span class="min-w-17.5 text-sm text-dim">{{ run.durationMs }}ms</span>
          <!-- mono-ok: stderr của lệnh -->
          <span v-if="run.stderr" class="flex-1 truncate font-mono text-sm text-destructive">
            {{ run.stderr }}
          </span>
          <span v-else class="flex-1" />
          <span class="text-sm text-dim">{{ run.at }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Hook detail pane — header cố định + thân cuộn, cùng bố cục với detail của
// skills/agents. Surfaces the event/matcher/command,
// the enabled toggle + run-mode/timeout chips, a project-tier trust gate
// (ADR 0032 D-8), and the recentRuns audit. Header actions emit to the page.
import { computed } from 'vue'
import type { Hook } from '~/stores/hooks'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ hook: Hook; running?: boolean }>()

const emit = defineEmits<{
  edit: []
  delete: []
  run: []
  toggle: []
  trust: []
}>()

const { t } = useI18n()

// Class dùng lại trong thân detail.
const SECH = 'mb-2 mt-5 text-xs font-semibold text-dim first:mt-0'
const TAG = 'text-muted-foreground'
const TAG_ACC = 'border-primary/45 bg-primary/8 text-primary'
const CTL = 'flex flex-col gap-1.5 rounded-lg border bg-muted px-3 py-2.5'
const CTL_LABEL = 'text-xs font-medium text-dim'
const KV = 'flex items-center gap-2.5 rounded-md border bg-muted px-3 py-2'

const isImported = computed(() => props.hook.readOnly === true)
const isProject = computed(() => (props.hook.source ?? 'global') === 'project')
const needsTrust = computed(() => isProject.value && props.hook.trusted === false)
const sourceLabel = computed(() => (isProject.value ? '.awog' : '~/.awog'))

const matcherEntries = computed(() => Object.entries(props.hook.matcher ?? {}))
const envCount = computed(() => Object.keys(props.hook.env ?? {}).length)
</script>
