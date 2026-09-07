<template>
  <span class="sb-wrap sl">
    <button
      class="sb-item sl-trigger"
      :class="{ 'sb-on': open }"
      :title="t('settingsStatusline.customize')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="text" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <template v-for="(seg, i) in segments" :key="i">
        <span v-if="i > 0" class="sl-dot">·</span>
        <span class="sl-seg">{{ seg }}</span>
      </template>
    </button>

    <template v-if="open">
      <div class="sb-backdrop" @click="open = false" />
      <div class="pop sb-pop sl-pop" @click.stop>
        <div class="sl-hd">
          <span>{{ t('settingsStatusline.heading') }}</span>
          <SettingsTog :model-value="statusline.enabled" @update:model-value="setEnabled" />
        </div>
        <p class="sl-sub">{{ t('settingsStatusline.sub') }}</p>

        <div v-if="projectId" class="sl-scope">
          <AppSelect v-model="scope" :options="scopeOptions" width="100%" />
          <span class="sl-origin">{{ originLabel }}</span>
        </div>

        <textarea
          v-model="draft"
          class="keyinp mono sl-ta"
          rows="2"
          spellcheck="false"
          :placeholder="DEFAULT_STATUS_LINE_TEMPLATE"
        />

        <div class="sl-vars">
          <button
            v-for="v in STATUS_LINE_VARS"
            :key="v"
            class="sl-chip"
            :title="t(`settingsStatusline.var.${v}`)"
            @click="insertVar(v)"
          >
            {{ varToken(v) }}
          </button>
        </div>

        <div v-if="unknown.length" class="sl-warn">
          {{ t('settingsStatusline.unknown', { names: unknown.join(', ') }) }}
        </div>

        <div class="sl-prev">
          <span class="sl-prevlbl">{{ t('settingsStatusline.preview') }}</span>
          <span class="sl-prevval">{{ preview || t('settingsStatusline.empty') }}</span>
        </div>

        <div class="sl-foot">
          <button class="btn sm" @click="reset">{{ t('settingsStatusline.reset') }}</button>
          <button
            v-if="scope === 'project' && hasProjectOverride"
            class="btn sm"
            @click="clearOverride"
          >
            {{ t('settingsStatusline.clearOverride') }}
          </button>
          <button class="btn sm pri" @click="save">{{ t('common.save') }}</button>
        </div>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Custom status-line segment (issue #41, docs/features/statusline.md). Renders the
// user's template — a string of `{variable}` placeholders resolved against a fixed
// table, never executed — and owns its small editor popover, since the template is
// edited far more often in place than from a settings pane.
//
// Two tiers (docs/features/settings.md): the user template lives in
// ~/.awog/settings.json; a project may override it in {project}/.awog/settings.json.
// The popover names which tier the live value comes from and can clear the override.
import { computed, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import {
  renderStatusLine,
  unknownStatusLineVars,
  useStatusLineValues,
  STATUS_LINE_VARS,
  type StatusLineVarId,
} from '~/composables/useStatusLine'
import { DEFAULT_STATUS_LINE_TEMPLATE, useSettingsStore } from '~/stores/settings'

const props = defineProps<{ session: Session | null }>()

const { t } = useI18n()
const settings = useSettingsStore()
const { statusline } = storeToRefs(settings)
const values = useStatusLineValues(() => props.session)

const open = ref(false)
// Plain string: AppSelect's v-model is `string`. Only 'project' is special-cased.
const scope = ref('user')
const draft = ref('')

const projectId = computed(() => props.session?.project || '')
// The project tier's own template ('' = no override), from the loaded overlay.
const projectTemplate = computed(
  () => settings.projectValue<string>('statusline', 'template') ?? '',
)
const hasProjectOverride = computed(() => projectTemplate.value.length > 0)
// Project wins when it declares one — the precedence the sidecar merge applies.
const template = computed(() => projectTemplate.value || statusline.value.template)

const segments = computed(() =>
  statusline.value.enabled ? renderStatusLine(template.value, values.value) : [],
)
const preview = computed(() => renderStatusLine(draft.value, values.value).join(' · '))
const unknown = computed(() => unknownStatusLineVars(draft.value))

const scopeOptions = computed(() => [
  { label: t('settingsStatusline.scope.user'), value: 'user' },
  { label: t('settingsStatusline.scope.project'), value: 'project' },
])
const originLabel = computed(() =>
  hasProjectOverride.value
    ? t('settingsStatusline.from.project')
    : t('settingsStatusline.from.user'),
)

// Keep the project overlay in sync with the session in view: it is what decides
// which template renders and what the popover reports.
watch(projectId, (id) => void settings.loadLayers(id || null), { immediate: true })

// Seed the editor from the tier being edited each time it opens / the tier changes.
watch([open, scope], () => {
  if (!open.value) return
  draft.value = scope.value === 'project' ? projectTemplate.value : statusline.value.template
})

function setEnabled(v: boolean) {
  settings.updateStatusline({ enabled: v })
}

// Literal placeholder text. Built in script, not in the template: `{{ }}` cannot
// carry a `{var}` literal without tripping the Vue expression parser.
const varToken = (v: StatusLineVarId) => `{${v}}`

function insertVar(v: StatusLineVarId) {
  const sep = draft.value && !draft.value.endsWith(' ') ? ' ' : ''
  draft.value = `${draft.value}${sep}${varToken(v)}`
}

async function save() {
  if (scope.value === 'project' && projectId.value) {
    await settings.setProjectOverride(projectId.value, { statusline: { template: draft.value } })
  } else {
    settings.updateStatusline({ template: draft.value })
  }
  open.value = false
}

function reset() {
  draft.value = DEFAULT_STATUS_LINE_TEMPLATE
}

async function clearOverride() {
  if (!projectId.value) return
  await settings.clearProjectOverride(projectId.value, ['statusline'])
  draft.value = ''
  open.value = false
}
</script>

<style scoped>
/* Popover chrome — the status bar is pinned to the window bottom, so the panel
   opens UPWARD. Left-aligned: this segment sits in the LEFT cluster. */
.sl {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.sl-pop.sb-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 95;
}
.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
}
.sl-trigger {
  max-width: 46ch;
  overflow: hidden;
}
.sl-trigger.sb-on {
  color: var(--accent);
  background: var(--accentDim);
}
.sl-seg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sl-dot {
  color: var(--textDim);
  opacity: 0.6;
}
.sl-pop {
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.sl-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.sl-sub,
.sl-origin {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin: 0;
}
.sl-scope {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sl-ta {
  width: 100%;
  resize: vertical;
  min-height: 3.4rem;
}
.sl-vars {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sl-chip {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-family: var(--code); /* mono-ok: literal placeholder text to paste */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.sl-chip:hover {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.sl-warn {
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sl-prev {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.sl-prevlbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex: 0 0 auto;
}
.sl-prevval {
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sl-foot {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
