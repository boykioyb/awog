<template>
  <div class="shrink-0 px-4 pb-3">
    <div
      class="rounded-xl border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring"
    >
      <!-- Quoted excerpts — from message Quote action or selection → Quote.
           Mirrors the production quote draft: blockquote chip + remove. -->
      <div v-if="quoteDraft.length" class="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
        <div
          v-for="(q, i) in quoteDraft"
          :key="'q' + i"
          class="group flex max-w-full items-start gap-2 rounded-lg border border-border bg-muted/40 py-1.5 pr-1.5 pl-2.5 text-xs"
        >
          <MessageSquareQuote class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span class="line-clamp-2 min-w-0 text-muted-foreground italic">{{ q }}</span>
          <Button
            variant="ghost"
            class="h-auto p-0 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Remove quote"
            @click="quoteDraft.splice(i, 1)"
          >
            <X class="size-3" />
          </Button>
        </div>
      </div>

      <!-- Pending attachments — SessionAttachmentChip idiom: image thumbs,
           file/folder icon + name, click → shared PreviewModal, × removes,
           overflow collapses into +N. -->
      <div v-if="composerAtts.length" class="flex flex-wrap items-center gap-1.5 px-2.5 pt-2.5">
        <template v-for="(a, i) in visibleAtts" :key="i">
          <button
            class="group flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            :title="`Preview ${a.name}`"
            @click="preview.open(a)"
          >
            <img
              v-if="a.kind === 'image' && a.src"
              :src="a.src"
              :alt="a.name"
              class="size-6 rounded object-cover"
            />
            <component :is="attIcon(a.kind)" v-else class="size-3.5" />
            <span class="max-w-36 truncate">{{ a.name }}</span>
            <span
              class="rounded p-0.5 opacity-60 hover:opacity-100"
              role="button"
              :aria-label="`Remove ${a.name}`"
              @click.stop="composerAtts.splice(i, 1)"
            >
              <X class="size-3" />
            </span>
          </button>
        </template>
        <Button
          v-if="composerAtts.length > 3"
          variant="outline"
          class="h-auto p-0 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          @click="showAllAtts = !showAllAtts"
        >
          {{ showAllAtts ? 'Show less' : `+${composerAtts.length - 3} more` }}
        </Button>
      </div>

      <Textarea
        v-model="draft"
        placeholder="Message the session… (Enter to send, ⇧Enter for newline)"
        class="min-h-[52px] resize-none border-0 bg-transparent px-3.5 py-2.5 shadow-none focus-visible:ring-0"
      />

      <div class="flex items-center gap-1 px-2 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="iconSm" aria-label="Attach">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-56">
            <DropdownMenuLabel>Attach</DropdownMenuLabel>
            <DropdownMenuItem @click="addFile">
              <Paperclip />
              File or folder…
            </DropdownMenuItem>
            <DropdownMenuItem @click="addImage">
              <Image />
              Image
            </DropdownMenuItem>
            <DropdownMenuItem @click="addVideo">
              <Film />
              Video…
            </DropdownMenuItem>
            <DropdownMenuItem @click="addMd">
              <FileText />
              Markdown doc…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Insert</DropdownMenuLabel>
            <DropdownMenuItem>
              <Slash />
              Command
            </DropdownMenuItem>
            <DropdownMenuItem>
              <AtSign />
              Connection
            </DropdownMenuItem>
            <DropdownMenuItem>
              <SquareTerminal />
              Terminal output
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" class="mx-1 !h-4" />

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" class="text-muted-foreground">
              <Sparkles />
              {{ model }}
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-44">
            <DropdownMenuLabel>Model</DropdownMenuLabel>
            <DropdownMenuItem v-for="m in models" :key="m" @click="model = m">
              {{ m }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm" class="text-muted-foreground">
              {{ effort }}
              <ChevronDown class="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" class="w-36">
            <DropdownMenuLabel>Effort</DropdownMenuLabel>
            <DropdownMenuItem v-for="e in efforts" :key="e" @click="effort = e">
              {{ e }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span class="flex-1" />

        <span class="mr-1 text-xs text-muted-foreground tabular-nums">{{ draft.length }}</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button size="iconSm" :disabled="!canSend" aria-label="Send" @click="send">
              <SendHorizontal />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Send ⏎</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Composer with the real pending-attachment flow: menu items push chips,
// chips preview via the shared modal, overflow collapses to +N, and quoted
// excerpts from selection→Quote land as removable draft context.
import { computed, ref } from 'vue'
import Button from '~/components/ui/button/Button.vue'
import {
  AtSign,
  ChevronDown,
  Eye,
  File,
  FileText,
  Film,
  Image,
  MessageSquareQuote,
  Paperclip,
  Plus,
  SendHorizontal,
  Slash,
  Sparkles,
  SquareTerminal,
  Video,
  X,
} from 'lucide-vue-next'
import { useProtoSession } from '~/composables/useProtoSession'
import { useProtoPreview, type ProtoAttachment } from '~/composables/useProtoPreview'

const draft = ref('')
const model = ref('Sonnet 4.5')
const effort = ref('High')
const models = ['Sonnet 4.5', 'Opus 4.1', 'Haiku 4.5', 'GPT-5', 'Gemini 3 Pro']
const efforts = ['Low', 'Medium', 'High', 'Max', 'Ultracode']

const { composerAtts, quoteDraft } = useProtoSession()
const preview = useProtoPreview()
const showAllAtts = ref(false)
const visibleAtts = computed(() =>
  showAllAtts.value ? composerAtts.value : composerAtts.value.slice(0, 3),
)
const canSend = computed(() => draft.value.trim().length > 0 || composerAtts.value.length > 0)

const attIcon = (kind: string) =>
  (({ image: Image, video: Video, markdown: Eye, text: FileText }) as Record<string, typeof File>)[
    kind
  ] ?? File

// Mock file pickers — Electron opens a native dialog + media:// src here.
const MOCK_FILES: ProtoAttachment[] = [
  {
    name: 'tailwind.config.ts',
    kind: 'text',
    size: '1.2 KB',
    lang: 'ts',
    text: "import type { Config } from 'tailwindcss'\n\nexport default {\n  theme: {\n    extend: {\n      colors: {\n        primary: 'var(--primary)',\n        background: 'var(--background)',\n      },\n    },\n  },\n} satisfies Config\n",
  },
  {
    name: 'proto-shadcn.css',
    kind: 'text',
    size: '3.4 KB',
    lang: 'css',
    text: 'body.proto-shadcn {\n  --background: oklch(0.145 0 0);\n  --foreground: oklch(0.985 0 0);\n  --radius: 0.625rem;\n}\n',
  },
  {
    name: 'useProtoSession.ts',
    kind: 'text',
    size: '9.8 KB',
    lang: 'ts',
    text: '// Mock data for the /proto/sessions preview\nexport interface ProtoMessage { … }\n',
  },
]
let fileIdx = 0
function addFile() {
  composerAtts.value.push(MOCK_FILES[fileIdx++ % MOCK_FILES.length]!)
}
function addImage() {
  composerAtts.value.push({
    name: 'screenshot-attach.png',
    kind: 'image',
    size: '182 KB',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#27272a"/><rect x="20" y="20" width="440" height="36" rx="8" fill="#3f3f46"/><rect x="20" y="76" width="200" height="204" rx="8" fill="#3f3f46"/><rect x="240" y="76" width="220" height="120" rx="8" fill="#3f3f46"/><rect x="240" y="216" width="220" height="64" rx="8" fill="#e4e4e7"/></svg>`,
      ),
  })
}
function addVideo() {
  composerAtts.value.push({
    name: 'screen-recording.mov',
    kind: 'video',
    size: '4.8 MB',
    src:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#09090b"/><circle cx="240" cy="125" r="34" fill="#e4e4e7" fill-opacity="0.9"/><path d="M230 108l34 17-34 17z" fill="#09090b"/></svg>`,
      ),
  })
}
function addMd() {
  composerAtts.value.push({
    name: 'notes.md',
    kind: 'markdown',
    size: '0.9 KB',
    text: '## Attach note\n\n- Image **thumbnail** + file icon chips\n- Click chip → shared `PreviewModal`\n- `+N` overflow collapse\n',
  })
}

function send() {
  draft.value = ''
  composerAtts.value = []
  quoteDraft.value = []
  showAllAtts.value = false
}
</script>
