<template>
  <div class="hkd">
    <div class="dh">
      <div class="hkd-icn"><Icon name="zap" style="width: 14px; height: 14px" /></div>
      <div class="dt">{{ hook.name }}</div>
      <span class="tag mono">{{ hook.event }}</span>
      <span class="tag" :class="{ acc: hook.runMode === 'blocking' }">{{ hook.runMode }}</span>
      <span class="tag" :class="{ acc: isProject }">{{ sourceLabel }}</span>
      <span v-if="isImported" class="tag hkd-lock">
        <Icon name="shield" style="width: 10px; height: 10px" />
        {{ t('hooks.detail.imported') }}
      </span>
      <span style="flex: 1" />
      <button
        v-if="!isImported"
        class="iconbtn hkd-act"
        :title="t('hooks.detail.runOnce')"
        :disabled="running"
        @click="emit('run')"
      >
        <Icon
          :name="running ? 'refresh' : 'play'"
          :class="{ spin: running }"
          style="width: 14px; height: 14px"
        />
      </button>
      <button class="iconbtn hkd-act" :title="t('hooks.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button
        v-if="!isImported"
        class="iconbtn hkd-act hkd-danger"
        :title="t('hooks.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p class="hkd-desc">{{ hook.description }}</p>

      <!-- Trust gate (ADR 0032 D-8): a project-tier hook must be explicitly
           trusted before it can spawn. -->
      <div v-if="needsTrust" class="hkd-trust">
        <Icon name="alert" class="hkd-trust-icn" style="width: 15px; height: 15px" />
        <div class="hkd-trust-body">
          <div class="hkd-trust-ttl">{{ t('hooks.trust.title') }}</div>
          <div class="hkd-trust-desc">{{ t('hooks.trust.desc') }}</div>
          <button class="btn sm hkd-trust-btn" @click="emit('trust')">
            <Icon name="shield" />
            {{ t('hooks.trust.button') }}
          </button>
        </div>
      </div>

      <!-- Quick controls -->
      <div class="hkd-controls">
        <div class="hkd-ctl">
          <span class="hkd-ctl-label">{{ t('hooks.detail.enabled') }}</span>
          <span
            class="tog2 hkd-tog"
            :class="{ off: !hook.enabled, locked: isImported }"
            :title="t('hooks.detail.toggleHint')"
            @click="!isImported && emit('toggle')"
          />
        </div>
        <div class="hkd-ctl">
          <span class="hkd-ctl-label">{{ t('hooks.detail.runMode') }}</span>
          <span class="hkd-ctl-val mono">{{ hook.runMode }}</span>
        </div>
        <div class="hkd-ctl">
          <span class="hkd-ctl-label">{{ t('hooks.detail.timeout') }}</span>
          <span class="hkd-ctl-val mono">{{ hook.timeoutMs }}ms</span>
        </div>
      </div>

      <!-- Matcher -->
      <div class="sech">{{ t('hooks.detail.matcher') }}</div>
      <div v-if="matcherEntries.length === 0" class="hkd-faint">
        {{ t('hooks.detail.matcherEmpty') }}
      </div>
      <div v-else class="hkd-kvs">
        <div v-for="[k, v] in matcherEntries" :key="k" class="hkd-kv">
          <span class="hkd-kv-key mono">{{ k }}</span>
          <span class="hkd-kv-val mono">{{ v }}</span>
        </div>
      </div>

      <!-- Command -->
      <div class="sech">{{ t('hooks.detail.command') }}</div>
      <pre class="codeblk hkd-cmd">{{ hook.command }}</pre>
      <div class="hkd-kvs hkd-kvs-tight">
        <div class="hkd-kv">
          <span class="hkd-kv-key">{{ t('hooks.detail.cwd') }}</span>
          <span class="hkd-kv-val mono">{{ hook.cwd }}</span>
        </div>
        <div class="hkd-kv">
          <span class="hkd-kv-key">{{ t('hooks.detail.env') }}</span>
          <span class="hkd-kv-val">{{ t('hooks.detail.envCount', { count: envCount }) }}</span>
        </div>
      </div>

      <!-- Recent runs -->
      <div class="sech">{{ t('hooks.detail.recentRuns', { count: hook.recentRuns.length }) }}</div>
      <div v-if="hook.recentRuns.length === 0" class="hkd-faint">
        {{ t('hooks.detail.noRuns') }}
      </div>
      <div v-else class="hkd-runs">
        <div v-for="(run, i) in hook.recentRuns" :key="i" class="hkd-run">
          <span
            class="hkd-run-dot"
            :style="{ background: run.exitCode === 0 ? 'var(--green)' : 'var(--danger)' }"
          />
          <span class="hkd-run-code mono">
            {{ run.exitCode === 0 ? 'OK' : `EXIT ${run.exitCode}` }}
          </span>
          <span class="hkd-run-dur">{{ run.durationMs }}ms</span>
          <span v-if="run.stderr" class="hkd-run-err mono">{{ run.stderr }}</span>
          <span v-else style="flex: 1" />
          <span class="hkd-run-at">{{ run.at }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Hook detail pane — rendered in prototype CSS (.dh header + .dscroll body,
// matching the skills/agents detail markup). Surfaces the event/matcher/command,
// the enabled toggle + run-mode/timeout chips, a project-tier trust gate
// (ADR 0032 D-8), and the recentRuns audit. Header actions emit to the page.
import { computed } from 'vue'
import type { Hook } from '~/stores/hooks'

const props = defineProps<{ hook: Hook; running?: boolean }>()

const emit = defineEmits<{
  edit: []
  delete: []
  run: []
  toggle: []
  trust: []
}>()

const { t } = useI18n()

const isImported = computed(() => props.hook.readOnly === true)
const isProject = computed(() => (props.hook.source ?? 'global') === 'project')
const needsTrust = computed(() => isProject.value && props.hook.trusted === false)
const sourceLabel = computed(() => (isProject.value ? '.awog' : '~/.awog'))

const matcherEntries = computed(() => Object.entries(props.hook.matcher ?? {}))
const envCount = computed(() => Object.keys(props.hook.env ?? {}).length)
</script>

<style scoped>
.hkd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.hkd-icn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  flex: 0 0 auto;
}
.hkd-act {
  width: 28px;
  height: 28px;
}
.hkd-act:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hkd-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.hkd-lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.hkd-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0;
}
.hkd-trust {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
}
.hkd-trust-icn {
  color: var(--amber);
  flex: 0 0 auto;
  margin-top: 2px;
}
.hkd-trust-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.hkd-trust-ttl {
  font-size: 1rem;
  font-weight: 600;
  color: var(--amber);
}
.hkd-trust-desc {
  font-size: 0.9231rem;
  color: var(--textMuted);
  line-height: 1.55;
}
.hkd-trust-btn {
  align-self: flex-start;
  margin-top: 6px;
}
.hkd-controls {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;
}
.hkd-ctl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.hkd-ctl-label {
  font-size: 0.8462rem;
  color: var(--textDim);
}
.hkd-ctl-val {
  font-size: 0.9615rem;
  color: var(--text);
}
.hkd-tog.locked {
  opacity: 0.5;
  cursor: not-allowed;
}
.hkd-faint {
  font-size: 0.9231rem;
  color: var(--textFaint);
}
.hkd-kvs {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hkd-kvs-tight {
  margin-top: 10px;
}
.hkd-kv {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.hkd-kv-key {
  font-size: 0.8846rem;
  color: var(--textDim);
  flex: 0 0 auto;
}
.hkd-kv-val {
  font-size: 0.9231rem;
  color: var(--text);
  word-break: break-all;
}
.hkd-cmd {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.hkd-runs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hkd-run {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  flex-wrap: wrap;
}
.hkd-run-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.hkd-run-code {
  font-size: 0.8846rem;
  color: var(--text);
  min-width: 56px;
}
.hkd-run-dur {
  font-size: 0.8846rem;
  color: var(--textDim);
  min-width: 70px;
}
.hkd-run-err {
  flex: 1;
  font-size: 0.8846rem;
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hkd-run-at {
  font-size: 0.8846rem;
  color: var(--textDim);
}
.spin {
  animation: hkd-spin 0.9s linear infinite;
}
@keyframes hkd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
