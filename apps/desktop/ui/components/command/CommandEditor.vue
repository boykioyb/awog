<template>
  <EditorShell
    :title="command?.id ? 'Edit Command' : 'New Command'"
    :dirty="dirty"
    :can-save="!!draft.name && !!draft.body"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name (after /)">
          <div class="flex items-center gap-1">
            <span class="font-mono text-[1em]" :style="{ color: t.textDim }">/</span>
            <input
              :value="draft.name"
              placeholder="review"
              class="flex-1 rounded px-2 py-1.5 text-[1em] font-mono"
              :style="inputStyle"
              @input="(e: Event) => (draft.name = slugify((e.target as HTMLInputElement).value))"
            />
          </div>
        </Field>
        <Field label="Type">
          <select
            v-model="draft.type"
            class="w-full rounded px-2 py-1.5 text-[1em]"
            :style="inputStyle"
          >
            <option value="prompt">prompt (template)</option>
            <option value="agent-switch">agent-switch</option>
            <option value="shell">shell</option>
            <option value="workflow">workflow</option>
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="2"
          class="w-full rounded px-2 py-1.5 text-[1em] resize-y min-h-[3rem]"
          :style="inputStyle"
        />
      </Field>

      <Field label="Aliases (comma separated)">
        <input
          v-model="aliasesText"
          placeholder="r, rev"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Scope">
          <select
            v-model="draft.scope"
            class="w-full rounded px-2 py-1.5 text-[1em]"
            :style="inputStyle"
          >
            <option value="global">global</option>
            <option v-for="p in ws.projects" :key="p.id" :value="`project:${p.id}`">
              project: {{ p.name }}
            </option>
            <option v-for="a in ws.agents" :key="a.id" :value="`agent:${a.id}`">
              agent: {{ a.name }}
            </option>
          </select>
        </Field>
        <Field v-if="draft.type === 'shell'" label="Timeout (ms)">
          <input
            v-model.number="draft.timeoutMs"
            type="number"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
        </Field>
        <div v-else />
      </div>

      <!-- Arguments -->
      <Field label="Arguments">
        <div class="space-y-2">
          <div
            v-for="(arg, i) in draft.args"
            :key="i"
            class="grid grid-cols-12 gap-1.5 items-center"
          >
            <input
              :value="arg.name"
              placeholder="name"
              class="col-span-3 rounded px-2 py-1 text-[1em] font-mono"
              :style="inputStyle"
              @input="(e: Event) => (arg.name = (e.target as HTMLInputElement).value)"
            />
            <select
              v-model="arg.type"
              class="col-span-2 rounded px-2 py-1 text-[1em]"
              :style="inputStyle"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="file">file</option>
              <option value="agent">agent</option>
              <option value="artifact">artifact</option>
              <option value="boolean">boolean</option>
            </select>
            <input
              :value="arg.description"
              placeholder="description"
              class="col-span-5 rounded px-2 py-1 text-[1em]"
              :style="inputStyle"
              @input="(e: Event) => (arg.description = (e.target as HTMLInputElement).value)"
            />
            <label
              class="col-span-1 flex items-center gap-1 text-[1em] cursor-pointer"
              :style="{ color: t.textDim }"
            >
              <input v-model="arg.required" type="checkbox" />
              req
            </label>
            <button
              class="col-span-1 flex justify-end"
              :style="{ color: t.textDim }"
              @click="draft.args = draft.args.filter((_, j) => j !== i)"
            >
              <X :size="11" />
            </button>
          </div>
          <button
            class="text-[1em] flex items-center gap-1"
            :style="{ color: t.textDim }"
            @click="addArg"
          >
            <Plus :size="11" />
            Add argument
          </button>
        </div>
      </Field>

      <Field :label="bodyLabel">
        <textarea
          v-model="draft.body"
          :rows="draft.type === 'prompt' ? 6 : 3"
          :placeholder="bodyPlaceholder"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono leading-relaxed resize-y min-h-[5rem]"
          :style="inputStyle"
        />
      </Field>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import type { CommandArg, CommandScope, CommandType, SlashCommand } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'

const props = defineProps<{
  command: SlashCommand | null
  initialDraft?: CommandDraft | null
}>()
const emit = defineEmits<{ save: [command: SlashCommand]; cancel: [] }>()

const { t } = useTheme()
const ws = useWorkspaceStore()

type Draft = Omit<SlashCommand, 'system'> & { system?: boolean }

const makeDefaults = (): Draft => ({
  id: '',
  name: '',
  aliases: [],
  description: '',
  type: 'prompt' as CommandType,
  args: [],
  body: '',
  scope: 'global' as CommandScope,
})

const cloneDraft = (d: CommandDraft): Draft => ({
  ...d,
  aliases: [...d.aliases],
  args: d.args.map((a) => ({ ...a })),
})

const initDraft = (c: SlashCommand | null, seed: CommandDraft | null | undefined): Draft => {
  if (c) {
    return {
      ...c,
      aliases: [...c.aliases],
      args: c.args.map((a) => ({ ...a })),
    }
  }
  return seed ? cloneDraft(seed) : makeDefaults()
}

const draft = ref<Draft>(initDraft(props.command, props.initialDraft))
const original = ref<Draft>(initDraft(props.command, props.initialDraft))
const aliasesText = ref(draft.value.aliases.join(', '))

watch(aliasesText, (v) => {
  draft.value.aliases = v
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
})

watch(
  () => props.command,
  (c) => {
    draft.value = initDraft(c, props.initialDraft)
    original.value = initDraft(c, props.initialDraft)
    aliasesText.value = draft.value.aliases.join(', ')
  },
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const bodyLabel = computed<string>(() => {
  switch (draft.value.type) {
    case 'prompt':
      return 'Prompt template'
    case 'agent-switch':
      return 'Target agent ID'
    case 'shell':
      return 'Shell command'
    case 'workflow':
      return 'Workflow ID'
    default:
      return 'Body'
  }
})

const bodyPlaceholder = computed<string>(() => {
  switch (draft.value.type) {
    case 'prompt':
      return 'Review {{context.lastArtifact.path}} focus on {{arg.focus}}'
    case 'agent-switch':
      return 'ag3'
    case 'shell':
      return 'pnpm test'
    case 'workflow':
      return 'wf2'
    default:
      return ''
  }
})

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const addArg = () => {
  const newArg: CommandArg = {
    name: 'arg',
    type: 'string',
    required: false,
    description: '',
  }
  draft.value.args = [...draft.value.args, newArg]
}

const onSave = () => {
  if (!draft.value.name || !draft.value.body) return
  emit('save', { ...draft.value } as SlashCommand)
}
</script>
