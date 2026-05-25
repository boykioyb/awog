<template>
  <div class="flex-1 flex flex-col overflow-hidden relative">
    <div
      class="px-4 md:px-6 py-3 flex items-center gap-2"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="min-w-0 flex-1">
        <input
          v-model="titleDraft"
          class="text-[14px] font-semibold bg-transparent outline-none w-full truncate"
          :style="{ color: t.text }"
          @blur="commitTitle"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <div class="text-[10px] mt-0.5 flex items-center gap-1.5" :style="{ color: t.textDim }">
          <span class="font-mono">{{ session.id }}</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span>{{ session.messages.length }} messages</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span>Updated {{ session.updatedAt }}</span>
          <span v-if="project" :style="{ color: t.textFaint }">·</span>
          <span v-if="project" class="inline-flex items-center gap-1">
            <FolderGit2 :size="10" />
            {{ project.name }}
          </span>
        </div>
      </div>
      <button
        class="p-1.5 rounded transition flex-shrink-0"
        :style="{ color: t.textDim }"
        title="Delete session"
        @click="emit('delete')"
      >
        <Trash2 :size="14" />
      </button>
    </div>

    <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
      <div v-for="msg in session.messages" :key="msg.id">
        <div
          v-if="msg.role === 'system'"
          class="text-center text-[10px] uppercase tracking-wider"
          :style="{ color: t.textDim }"
        >
          ── {{ msg.text }} · {{ msg.at }} ──
        </div>

        <div v-else>
          <div v-if="msg.role === 'user'" class="flex flex-col items-end gap-1.5">
            <div
              v-if="msg.text"
              class="rounded-2xl px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
              :style="{
                background: t.bgElevated,
                color: t.text,
                border: `1px solid ${t.border}`,
                maxWidth: '78%',
              }"
            >
              <template v-for="(seg, i) in segmentsFor(msg)" :key="i">
                <span
                  v-if="seg.kind === 'token'"
                  :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
                >
                  {{ seg.text }}
                </span>
                <template v-else>{{ seg.text }}</template>
              </template>
            </div>
            <div
              v-if="msg.attachments?.length"
              class="flex flex-wrap gap-1.5 justify-end"
              :style="{ maxWidth: '78%' }"
            >
              <template v-for="att in msg.attachments" :key="att.id">
                <button
                  v-if="att.type === 'image' && att.url"
                  type="button"
                  class="rounded-md overflow-hidden relative group transition"
                  :style="{
                    width: '160px',
                    height: '100px',
                    border: `1px solid ${t.border}`,
                    background: t.bgSubtle,
                  }"
                  :title="`View ${att.name}${att.size ? ` · ${att.size}` : ''}`"
                  @click="openAttachment(att)"
                >
                  <img
                    :src="att.url"
                    :alt="att.name"
                    class="w-full h-full object-cover"
                    draggable="false"
                  />
                  <div
                    class="absolute inset-x-0 bottom-0 px-2 py-1 flex items-center gap-1"
                    :style="{
                      background: 'rgba(0,0,0,0.55)',
                      backdropFilter: 'blur(4px)',
                    }"
                  >
                    <span
                      class="text-[10px] font-mono truncate flex-1 text-left"
                      :style="{ color: '#fff' }"
                    >
                      {{ att.name }}
                    </span>
                    <Maximize2
                      :size="10"
                      :style="{ color: 'rgba(255,255,255,0.8)', flexShrink: 0 }"
                    />
                  </div>
                </button>
                <button
                  v-else
                  type="button"
                  class="rounded-md flex items-center gap-2.5 px-3 text-left transition"
                  :style="{
                    height: '44px',
                    minWidth: '180px',
                    maxWidth: '260px',
                    background: t.bgSubtle,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    cursor: att.preview ? 'pointer' : 'default',
                    opacity: att.preview ? 1 : 0.85,
                  }"
                  :disabled="!att.preview"
                  :title="
                    att.preview
                      ? `View ${att.name}${att.size ? ` · ${att.size}` : ''}`
                      : `${att.name}${att.size ? ` · ${att.size}` : ''}`
                  "
                  @click="openAttachment(att)"
                >
                  <component
                    :is="fileIconFor(att.name).icon"
                    :size="18"
                    class="flex-shrink-0"
                    :style="{ color: fileIconFor(att.name).color }"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="font-mono text-[12px] truncate" :style="{ color: t.text }">
                      {{ att.name }}
                    </div>
                    <div
                      class="text-[10px] truncate flex items-center gap-1.5"
                      :style="{ color: t.textFaint }"
                    >
                      <span :style="{ color: fileIconFor(att.name).color, fontWeight: 500 }">
                        {{ fileIconFor(att.name).label }}
                      </span>
                      <span v-if="att.size">· {{ att.size }}</span>
                    </div>
                  </div>
                </button>
              </template>
            </div>
            <div v-if="msg.modeAtSend" class="text-[9px]" :style="{ color: t.textFaint }">
              · sent in {{ msg.modeAtSend }} mode
            </div>
          </div>

          <div v-if="msg.role === 'agent'" class="text-[13px] leading-relaxed">
            <div v-if="msg.text" class="whitespace-pre-wrap" :style="{ color: t.text }">
              <template v-for="(seg, i) in segmentsFor(msg)" :key="i">
                <span
                  v-if="seg.kind === 'token'"
                  :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
                >
                  {{ seg.text }}
                </span>
                <template v-else>{{ seg.text }}</template>
              </template>
            </div>

            <div v-if="msg.steps?.length" :class="msg.text ? 'mt-2 space-y-1' : 'space-y-1'">
              <StepItem v-for="step in msg.steps" :key="step.id" :step="step" />
            </div>

            <div v-if="msg.artifacts?.length" class="mt-2 space-y-1.5">
              <div
                v-for="art in msg.artifacts"
                :key="art.name"
                class="rounded"
                :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
              >
                <div
                  class="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]"
                  :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
                >
                  <FileText :size="11" :style="{ color: t.textDim }" />
                  <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
                </div>
                <pre
                  v-if="art.preview"
                  class="text-[11px] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
                  :style="{ color: t.textMuted, maxHeight: '160px' }"
                  >{{ art.preview }}</pre
                >
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-for="agentId in session.pendingAgentIds"
        :key="`pending-${agentId}`"
        class="flex gap-1.5 items-center"
      >
        <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
        <span class="text-[11px]" :style="{ color: t.textDim }">
          {{ agentName(agentId) }} đang phản hồi...
        </span>
      </div>
    </div>

    <div
      class="px-4 md:px-6 py-2 relative"
      :style="{ background: t.bg, borderTop: `1px solid ${t.border}` }"
    >
      <div
        v-if="autocomplete.items.length > 0"
        class="absolute left-4 right-4 md:left-6 md:right-6 bottom-full mb-1 rounded-md overflow-hidden z-10"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 8px 24px ${t.shadow}`,
          maxHeight: '280px',
          overflowY: 'auto',
        }"
      >
        <div
          class="px-2.5 py-1 text-[10px] uppercase tracking-wider flex items-center justify-between"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          <span>{{ autocomplete.title }}</span>
          <span class="font-mono normal-case" :style="{ color: t.textFaint }">
            ↑↓ navigate · ↵ pick · esc close
          </span>
        </div>
        <button
          v-for="(item, i) in autocomplete.items"
          :key="`${item.kind}-${item.id}`"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition"
          :style="{
            background: i === autocompleteIdx ? t.bgActive : 'transparent',
            color: t.text,
          }"
          @mouseenter="autocompleteIdx = i"
          @mousedown.prevent="applyAutocomplete(item)"
        >
          <component
            :is="item.icon"
            :size="11"
            class="flex-shrink-0"
            :style="{ color: tokenColor(item.kind) }"
          />
          <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
          <span
            v-if="item.hint"
            class="font-mono text-[10px] truncate"
            :style="{ color: t.textDim, maxWidth: '50%' }"
          >
            {{ item.hint }}
          </span>
        </button>
      </div>

      <div
        class="rounded-md"
        :style="{
          background: t.bgInput,
          border: `1px solid ${composerFocus ? t.borderFocus : t.border}`,
        }"
      >
        <!-- Top toolbar: chips + actions -->
        <div
          class="px-2 py-1 flex items-center gap-1 flex-wrap"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div ref="providerPopRef" class="relative">
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] transition"
              :style="chipStyle(providerPopOpen)"
              @click="togglePop('provider')"
            >
              <Cable :size="10" />
              {{ providerLabel }}
              <ChevronDown :size="9" :style="{ color: t.textDim }" />
            </button>
            <div
              v-if="providerPopOpen"
              class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
              :style="popStyle"
            >
              <div
                class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
                :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
              >
                Connection
              </div>
              <button
                v-for="p in availableProviders"
                :key="p"
                class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
                :style="{
                  background: session.settings.provider === p ? t.bgActive : 'transparent',
                  color: t.text,
                }"
                @click="onPickProvider(p)"
              >
                <span
                  class="inline-block w-1.5 h-1.5 rounded-full"
                  :style="{
                    background: settings.isProviderConnected(p) ? t.success : t.textFaint,
                  }"
                />
                {{ PROVIDER_LABEL[p] }}
                <span
                  v-if="!settings.isProviderConnected(p)"
                  class="ml-auto text-[9px] uppercase tracking-wider"
                  :style="{ color: t.textDim }"
                >
                  Not connected
                </span>
              </button>
            </div>
          </div>

          <div ref="modelPopRef" class="relative">
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] transition"
              :style="chipStyle(modelPopOpen)"
              @click="togglePop('model')"
            >
              <Sparkles :size="10" />
              {{ currentModel?.label ?? 'Pick model' }}
              <ChevronDown :size="9" :style="{ color: t.textDim }" />
            </button>
            <div
              v-if="modelPopOpen"
              class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
              :style="popStyle"
            >
              <div
                class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
                :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
              >
                {{ PROVIDER_LABEL[session.settings.provider] }} · Model
              </div>
              <button
                v-for="m in availableModels"
                :key="m.id"
                class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
                :style="{
                  background: session.settings.modelId === m.id ? t.bgActive : 'transparent',
                  color: t.text,
                }"
                @click="onPickModel(m.id)"
              >
                <span class="flex-1 min-w-0">{{ m.label }}</span>
                <span class="text-[9px] uppercase tracking-wider" :style="{ color: t.textDim }">
                  {{ m.tier }}
                </span>
              </button>
            </div>
          </div>

          <div ref="levelPopRef" class="relative">
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] transition"
              :style="chipStyle(levelPopOpen)"
              :disabled="availableLevels.length <= 1"
              @click="togglePop('level')"
            >
              <Gauge :size="10" />
              {{ LEVEL_LABEL[session.settings.level] }}
              <ChevronDown
                v-if="availableLevels.length > 1"
                :size="9"
                :style="{ color: t.textDim }"
              />
            </button>
            <div
              v-if="levelPopOpen"
              class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
              :style="popStyle"
            >
              <div
                class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
                :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
              >
                Thinking level
              </div>
              <button
                v-for="lv in availableLevels"
                :key="lv"
                class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition"
                :style="{
                  background: session.settings.level === lv ? t.bgActive : 'transparent',
                  color: t.text,
                }"
                @click="onPickLevel(lv)"
              >
                {{ LEVEL_LABEL[lv] }}
              </button>
            </div>
          </div>

          <div ref="modePopRef" class="relative">
            <button
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] transition"
              :style="chipStyle(modePopOpen)"
              @click="togglePop('mode')"
            >
              <component :is="currentModeDef.icon" :size="10" />
              {{ currentModeDef.label }}
              <ChevronDown :size="9" :style="{ color: t.textDim }" />
            </button>
            <div
              v-if="modePopOpen"
              class="absolute left-0 bottom-full mb-1 rounded-md py-1 z-20"
              :style="popStyle"
            >
              <div
                class="px-2.5 py-1 text-[10px] uppercase tracking-wider"
                :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
              >
                Mode
              </div>
              <button
                v-for="m in modeOptions"
                :key="m.value"
                class="w-full text-left px-2.5 py-1.5 flex items-start gap-2 text-[11px] transition"
                :style="{
                  background: session.settings.mode === m.value ? t.bgActive : 'transparent',
                  color: t.text,
                  minWidth: '220px',
                }"
                @click="onPickMode(m.value)"
              >
                <component
                  :is="m.icon"
                  :size="11"
                  class="mt-0.5 flex-shrink-0"
                  :style="{ color: t.textDim }"
                />
                <div class="flex-1 min-w-0">
                  <div :style="{ color: t.text }">{{ m.label }}</div>
                  <div class="text-[10px] leading-snug" :style="{ color: t.textDim }">
                    {{ m.desc }}
                  </div>
                </div>
              </button>
            </div>
          </div>

          <button
            class="ml-auto inline-flex items-center justify-center w-6 h-6 rounded transition"
            :style="{ color: t.textDim }"
            title="Attach file or image"
            @click="onAttachClick"
          >
            <Paperclip :size="12" />
          </button>
          <button
            :disabled="!canSend"
            class="inline-flex items-center justify-center w-6 h-6 rounded transition"
            :style="{
              background: !canSend ? 'transparent' : t.accent,
              color: !canSend ? t.textFaint : t.accentText,
              cursor: !canSend ? 'not-allowed' : 'pointer',
            }"
            title="Send (Enter)"
            @click="onSend"
          >
            <Send :size="12" />
          </button>
        </div>

        <textarea
          ref="textareaRef"
          v-model="draft"
          rows="2"
          :placeholder="placeholder"
          class="w-full bg-transparent px-3 py-2 text-[13px] resize-none outline-none"
          :style="{ color: t.text }"
          @focus="composerFocus = true"
          @blur="onBlur"
          @input="updateMention"
          @click="updateMention"
          @keyup="updateMention"
          @keydown="onComposerKeydown"
        />

        <div
          v-if="pendingAttachments.length > 0"
          class="px-2 py-1.5 flex flex-wrap gap-1.5 items-end"
          :style="{ borderTop: `1px solid ${t.border}` }"
        >
          <template v-for="att in pendingAttachments" :key="att.id">
            <div
              v-if="att.type === 'image' && att.url"
              class="relative group rounded overflow-hidden"
              :style="{
                width: '72px',
                height: '54px',
                border: `1px solid ${t.border}`,
                background: t.bgSubtle,
              }"
              :title="att.name"
            >
              <img :src="att.url" :alt="att.name" class="w-full h-full object-cover" />
              <button
                class="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full"
                :style="{ background: 'rgba(0,0,0,0.65)', color: '#fff' }"
                @click="removeAttachment(att.id)"
              >
                <X :size="9" />
              </button>
            </div>
            <div
              v-else
              class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
              :style="{
                background: t.bgSubtle,
                color: t.text,
                border: `1px solid ${t.border}`,
              }"
            >
              <FileText :size="11" :style="{ color: t.textDim }" />
              <span class="font-mono truncate" :style="{ maxWidth: '180px' }">{{ att.name }}</span>
              <span v-if="att.size" :style="{ color: t.textFaint }">{{ att.size }}</span>
              <button
                class="text-[10px] inline-flex items-center"
                :style="{ color: t.textDim }"
                @click="removeAttachment(att.id)"
              >
                <X :size="10" />
              </button>
            </div>
          </template>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          multiple
          accept="*/*"
          class="hidden"
          @change="onFileSelected"
        />
      </div>
      <div class="text-[9px] mt-1 px-1" :style="{ color: t.textFaint }">
        Enter to send · @ skill / file · $ agent · / command
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="selectedStep"
        class="fixed inset-0 z-40 flex items-stretch justify-end"
        :style="{ background: 'rgba(0, 0, 0, 0.25)' }"
        @click.self="selectedStep = null"
      >
        <SessionStepDetail :step="selectedStep" floating @close="selectedStep = null" />
      </div>
    </Teleport>

    <AttachmentLightbox
      v-if="viewingAttachment"
      :attachment="viewingAttachment"
      @close="viewingAttachment = null"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  Cable,
  CheckCheck,
  ChevronDown,
  Maximize2,
  FileText,
  FolderGit2,
  Gauge,
  HelpCircle,
  ListChecks,
  type LucideIcon,
  Paperclip,
  Play,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-vue-next'
import type {
  Agent,
  AgentMode,
  ProviderName,
  Session,
  SessionAttachment,
  SessionMessage,
  SessionStep,
  SessionTokenKind,
  ThinkingLevel,
} from '~/types'
import {
  LEVEL_LABEL,
  PROVIDER_LABEL,
  levelsForModel,
  modelById,
  modelsForProvider,
} from '~/utils/models'
import { fileIconFor } from '~/utils/file-icon'
import { COMMANDS, PROJECT_FILES } from '~/utils/session-catalog'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{ delete: [] }>()

const { t } = useTheme()
const store = useSessionsStore()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()

const draft = ref('')
const composerFocus = ref(false)
const titleDraft = ref(props.session.title)
const selectedStep = ref<SessionStep | null>(null)
const selectedStepId = computed(() => selectedStep.value?.id ?? null)

provide(SELECT_STEP_KEY, (step: SessionStep) => {
  selectedStep.value = step
})
provide(SELECTED_STEP_ID_KEY, selectedStepId)

const onEscape = (ev: KeyboardEvent) => {
  if (ev.key === 'Escape' && selectedStep.value) {
    selectedStep.value = null
  }
}
onMounted(() => window.addEventListener('keydown', onEscape))
onUnmounted(() => window.removeEventListener('keydown', onEscape))
const scrollRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const mentionToken = ref<string | null>(null)
const mentionTrigger = ref<'@' | '$' | '/' | null>(null)
const mentionStart = ref(0)
const autocompleteIdx = ref(0)

type PopoverName = 'provider' | 'model' | 'level' | 'mode' | null
const openPop = ref<PopoverName>(null)
const providerPopOpen = computed(() => openPop.value === 'provider')
const modelPopOpen = computed(() => openPop.value === 'model')
const levelPopOpen = computed(() => openPop.value === 'level')
const modePopOpen = computed(() => openPop.value === 'mode')
const providerPopRef = ref<HTMLElement | null>(null)
const modelPopRef = ref<HTMLElement | null>(null)
const levelPopRef = ref<HTMLElement | null>(null)
const modePopRef = ref<HTMLElement | null>(null)

const agentHandle = (ag: Agent) => ag.name.toLowerCase().replace(/\s+/g, '-')

watch(
  () => props.session.id,
  () => {
    titleDraft.value = props.session.title
    draft.value = ''
    mentionToken.value = null
    openPop.value = null
    selectedStep.value = null
  },
)

const closePopOnOutside = (ev: MouseEvent) => {
  if (!openPop.value) return
  const tgt = ev.target as Node | null
  const refs = [providerPopRef.value, modelPopRef.value, levelPopRef.value, modePopRef.value]
  if (tgt && refs.some((r) => r && r.contains(tgt))) return
  openPop.value = null
}

onMounted(() => {
  document.addEventListener('mousedown', closePopOnOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', closePopOnOutside)
})

watch(
  () => props.session.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  },
)

const project = computed(() =>
  props.session.projectId ? workspace.projectById(props.session.projectId) : undefined,
)

const placeholder = computed(() =>
  props.session.invitedAgentIds.length === 0
    ? 'Note xuống ý nghĩ, hoặc @mention một agent để mời họ vào...'
    : 'Type a message... (Enter to send)',
)

const availableProviders = computed<ProviderName[]>(() => ['anthropic', 'openai', 'google'])

const availableModels = computed(() => modelsForProvider(props.session.settings.provider))

const currentModel = computed(() => modelById(props.session.settings.modelId))

const availableLevels = computed(() => levelsForModel(currentModel.value))

const providerLabel = computed(() => PROVIDER_LABEL[props.session.settings.provider])

const popStyle = computed(() => ({
  background: t.value.bgPanel,
  border: `1px solid ${t.value.borderStrong}`,
  boxShadow: `0 8px 24px ${t.value.shadow}`,
  minWidth: '200px',
}))

const chipStyle = (active: boolean) => ({
  background: active ? t.value.bgActive : t.value.bgSubtle,
  color: t.value.text,
  border: `1px solid ${active ? t.value.borderFocus : t.value.border}`,
})

const togglePop = (name: NonNullable<PopoverName>) => {
  openPop.value = openPop.value === name ? null : name
}

const onPickProvider = (p: ProviderName) => {
  if (!settings.isProviderConnected(p)) return
  const firstModel = modelsForProvider(p)[0]
  if (!firstModel) return
  const levels = levelsForModel(firstModel)
  store.updateSettings(props.session.id, {
    provider: p,
    modelId: firstModel.id,
    level: levels.includes(props.session.settings.level) ? props.session.settings.level : levels[0],
  })
  openPop.value = null
}

const onPickModel = (modelId: string) => {
  const model = modelById(modelId)
  if (!model) return
  const levels = levelsForModel(model)
  store.updateSettings(props.session.id, {
    modelId,
    level: levels.includes(props.session.settings.level) ? props.session.settings.level : levels[0],
  })
  openPop.value = null
}

const onPickLevel = (lv: ThinkingLevel) => {
  store.updateSettings(props.session.id, { level: lv })
  openPop.value = null
}

const modeOptions = [
  {
    value: 'ask' as const,
    label: 'Ask',
    icon: HelpCircle,
    desc: 'Đọc + trả lời. Không tự sửa file.',
  },
  {
    value: 'accept-edits' as const,
    label: 'Accept Edits',
    icon: CheckCheck,
    desc: 'Tự áp dụng mọi edit, không hỏi xác nhận.',
  },
  {
    value: 'plan' as const,
    label: 'Plan',
    icon: ListChecks,
    desc: 'Lập kế hoạch + propose patch, chưa thực thi.',
  },
  {
    value: 'execute' as const,
    label: 'Execute',
    icon: Play,
    desc: 'Toàn quyền — chạy lệnh, sửa file, gọi tool.',
  },
]

const currentModeDef = computed(
  () => modeOptions.find((m) => m.value === props.session.settings.mode) ?? modeOptions[0]!,
)

const onPickMode = (m: AgentMode) => {
  store.updateSettings(props.session.id, { mode: m })
  openPop.value = null
}

interface AutoItem {
  kind: SessionTokenKind
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  insertHandle: string
}

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}

const autocomplete = computed<{ title: string; items: AutoItem[] }>(() => {
  if (mentionToken.value === null) return { title: '', items: [] }
  const trigger = mentionTrigger.value
  const q = mentionToken.value.toLowerCase()

  if (trigger === '$') {
    const items: AutoItem[] = workspace.agents
      .filter((a) => {
        const h = agentHandle(a)
        return (
          q === '' ||
          h.startsWith(q) ||
          a.role.toLowerCase().startsWith(q) ||
          a.name.toLowerCase().includes(q)
        )
      })
      .slice(0, 6)
      .map((a) => ({
        kind: 'agent',
        id: a.id,
        label: a.name,
        hint: `$${agentHandle(a)} · ${a.role}`,
        icon: UserIcon,
        insertHandle: `$${agentHandle(a)}`,
      }))
    return { title: 'Invoke agent', items }
  }

  if (trigger === '/') {
    const items: AutoItem[] = COMMANDS.filter((c) => q === '' || c.name.startsWith(q))
      .slice(0, 8)
      .map((c) => ({
        kind: 'command',
        id: c.id,
        label: `/${c.name}`,
        hint: c.description,
        icon: c.icon,
        insertHandle: `/${c.name}`,
      }))
    return { title: 'Run command', items }
  }

  // trigger '@' → skills + files mixed
  const skillItems: AutoItem[] = workspace.skills
    .filter((s) => q === '' || s.name.toLowerCase().includes(q))
    .slice(0, 4)
    .map((s) => ({
      kind: 'skill',
      id: s.id,
      label: s.name,
      hint: s.category,
      icon: Sparkles,
      insertHandle: `@${s.name}`,
    }))

  const fileItems: AutoItem[] = PROJECT_FILES.filter(
    (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
  )
    .slice(0, 6)
    .map((f) => ({
      kind: 'file',
      id: f.id,
      label: f.name,
      hint: f.path,
      icon: FileText,
      insertHandle: `@${f.path}`,
    }))

  return { title: 'Insert skill or file', items: [...skillItems, ...fileItems] }
})

const detectMention = () => {
  const el = textareaRef.value
  if (!el) {
    mentionToken.value = null
    return
  }
  const pos = el.selectionStart ?? 0
  const before = draft.value.slice(0, pos)
  const triggers: ('@' | '$' | '/')[] = ['@', '$', '/']
  let triggerIdx = -1
  let triggerChar: '@' | '$' | '/' | null = null
  triggers.forEach((c) => {
    const idx = before.lastIndexOf(c)
    if (idx > triggerIdx) {
      triggerIdx = idx
      triggerChar = c
    }
  })
  if (triggerIdx < 0 || triggerChar === null) {
    mentionToken.value = null
    return
  }
  // valid if trigger is at start or after whitespace
  if (triggerIdx > 0 && !/\s/.test(before[triggerIdx - 1] ?? '')) {
    mentionToken.value = null
    return
  }
  const token = before.slice(triggerIdx + 1)
  if (/\s/.test(token)) {
    mentionToken.value = null
    return
  }
  mentionToken.value = token
  mentionTrigger.value = triggerChar
  mentionStart.value = triggerIdx
  autocompleteIdx.value = 0
}

const updateMention = () => {
  detectMention()
}

const applyAutocomplete = (item: AutoItem) => {
  if (mentionToken.value === null) return
  const before = draft.value.slice(0, mentionStart.value)
  const afterPos = mentionStart.value + 1 + mentionToken.value.length
  const after = draft.value.slice(afterPos)
  const inserted = `${item.insertHandle} `
  draft.value = `${before}${inserted}${after}`
  const newPos = before.length + inserted.length
  mentionToken.value = null
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(newPos, newPos)
  })
}

const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingAttachments = ref<SessionAttachment[]>([])

const canSend = computed(() => draft.value.trim().length > 0 || pendingAttachments.value.length > 0)

const onSend = () => {
  if (!canSend.value) return
  const text = draft.value
  const attachments = pendingAttachments.value.length ? [...pendingAttachments.value] : undefined
  store.sendMessage(props.session.id, text, attachments)
  draft.value = ''
  pendingAttachments.value = []
}

const onComposerKeydown = (ev: KeyboardEvent) => {
  if (autocomplete.value.items.length > 0) {
    const n = autocomplete.value.items.length
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      autocompleteIdx.value = (autocompleteIdx.value + 1) % n
      return
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      autocompleteIdx.value = (autocompleteIdx.value - 1 + n) % n
      return
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      const pick = autocomplete.value.items[autocompleteIdx.value]
      if (pick) applyAutocomplete(pick)
      return
    }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      mentionToken.value = null
      return
    }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    onSend()
  }
}

const onBlur = () => {
  composerFocus.value = false
  // delay to allow mousedown to trigger applyAutocomplete before dropdown closes
  setTimeout(() => {
    mentionToken.value = null
  }, 100)
}

const onAttachClick = () => {
  fileInputRef.value?.click()
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const onFileSelected = (ev: Event) => {
  const input = ev.target as HTMLInputElement
  if (!input.files) return
  Array.from(input.files).forEach((f) => {
    const isImage = f.type.startsWith('image/')
    pendingAttachments.value.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      type: isImage ? 'image' : 'file',
      size: fmtSize(f.size),
      mime: f.type,
      url: isImage ? URL.createObjectURL(f) : undefined,
    })
  })
  input.value = ''
}

const removeAttachment = (id: string) => {
  const removed = pendingAttachments.value.find((a) => a.id === id)
  if (removed?.url && removed.url.startsWith('blob:')) {
    URL.revokeObjectURL(removed.url)
  }
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
}

const viewingAttachment = ref<SessionAttachment | null>(null)
const openAttachment = (att: SessionAttachment) => {
  if (att.type === 'image') {
    if (!att.url) return
  } else if (!att.preview) {
    return
  }
  viewingAttachment.value = att
}

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

interface TextSegment {
  kind: 'text' | 'token'
  tokenKind?: SessionTokenKind
  text: string
}

const segmentsFor = (msg: SessionMessage): TextSegment[] => {
  const out: TextSegment[] = []
  // matches @path/file, @skill, $agent, /command
  const re = /([@$])([\w./-]+)|\/(\w+)/g
  let last = 0
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(msg.text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: msg.text.slice(last, m.index) })
    const full = m[0]
    let tk: SessionTokenKind
    if (m[1] === '$') tk = 'agent'
    else if (m[1] === '@') tk = full.includes('/') || full.includes('.') ? 'file' : 'skill'
    else tk = 'command'
    out.push({ kind: 'token', tokenKind: tk, text: full })
    last = m.index + full.length
  }
  if (last < msg.text.length) out.push({ kind: 'text', text: msg.text.slice(last) })
  return out
}

const commitTitle = () => {
  const next = titleDraft.value.trim() || 'Untitled session'
  if (next !== props.session.title) store.renameSession(props.session.id, next)
  titleDraft.value = next
}
</script>
