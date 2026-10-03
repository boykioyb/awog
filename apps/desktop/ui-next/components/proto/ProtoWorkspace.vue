<template>
  <div class="flex h-full flex-col bg-background">
    <Tabs v-model="tab" class="flex min-h-0 flex-1 flex-col gap-0">
      <!-- Tab strip — SessionWorkspacePanel §3.5 parity: inactive tabs are
           icon-only (the label lives in `title`), `×` shows only on the active
           or hovered tab, `+` re-adds a closed view, right-click picks the
           dock side. Panel can drag to ~240px without the strip overflowing. -->
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <div class="flex items-center gap-0.5 border-b border-border px-1.5">
            <TabsList
              class="h-9 min-w-0 flex-1 justify-start gap-0 rounded-none bg-transparent p-0"
            >
              <TabsTrigger
                v-for="t in openViewList"
                :key="t.value"
                :value="t.value"
                :title="t.label"
                class="group/wtab h-9 shrink-0 gap-1 rounded-none border-b-2 border-transparent px-2 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <component :is="t.icon" class="size-3.5" />
                <!-- active tab keeps its label; inactive are icon-only -->
                <span v-if="t.value === tab">{{ t.label }}</span>
                <span
                  v-if="t.value === 'code' && file"
                  class="max-w-20 truncate text-muted-foreground"
                >
                  · {{ file.name }}
                </span>
                <span
                  role="button"
                  tabindex="-1"
                  aria-label="Close view"
                  :class="[
                    'flex size-3.5 items-center justify-center rounded-sm transition-opacity hover:bg-accent-foreground/15',
                    t.value === tab ? 'opacity-100' : 'opacity-0 group-hover/wtab:opacity-100',
                  ]"
                  @click.stop.prevent="closeView(t.value)"
                  @pointerdown.stop.prevent
                >
                  <X class="size-2.5" />
                </span>
              </TabsTrigger>
            </TabsList>

            <!-- + re-add a closed view -->
            <DropdownMenu v-if="addable.length">
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="iconSm" class="size-6 shrink-0" aria-label="Add view">
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-40">
                <DropdownMenuItem v-for="t in addable" :key="t.value" @click="addView(t.value)">
                  <component :is="t.icon" />
                  {{ t.label }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6 shrink-0"
              aria-label="Close workspace"
              @click="emits('update:open', false)"
            >
              <X />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-44">
          <ContextMenuLabel>Dock panel</ContextMenuLabel>
          <ContextMenuItem
            v-for="opt in DOCK_OPTS"
            :key="opt.side"
            @click="emits('update:dock', opt.side)"
          >
            <component :is="opt.icon" />
            {{ opt.label }}
            <Check v-if="dock === opt.side" class="ml-auto size-3.5 text-primary" />
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <!-- Plan -->
      <TabsContent value="plan" class="m-0 min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="flex flex-col gap-4 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-foreground">shadcn-vue migration</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Refactor toàn bộ UI lên primitive shadcn-vue thật trên reka-ui.
                </p>
              </div>
              <Badge variant="secondary">running</Badge>
            </div>
            <div class="flex flex-col">
              <div
                v-for="(p, i) in plan"
                :key="i"
                class="flex items-center gap-2.5 border-b border-border/60 py-2 text-sm last:border-0"
              >
                <CheckCircle2 v-if="p.done" class="size-4 shrink-0 text-success" />
                <Circle v-else class="size-4 shrink-0 text-muted-foreground" />
                <span :class="p.done ? 'text-muted-foreground line-through' : 'text-foreground'">
                  {{ p.text }}
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <!-- Tasks -->
      <TabsContent value="tasks" class="m-0 min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="flex flex-col gap-1.5 p-3">
            <div
              v-for="t in tasks"
              :key="t.id"
              class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
            >
              <component
                :is="taskMeta[t.status].icon"
                :class="['size-3.5 shrink-0', taskMeta[t.status].cls]"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-foreground">{{ t.title }}</p>
                <p class="text-xs text-muted-foreground tabular-nums">{{ t.duration }}</p>
              </div>
              <Badge
                :variant="t.status === 'failed' ? 'destructive' : 'secondary'"
                class="shrink-0"
              >
                {{ t.status }}
              </Badge>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <!-- Files — click a file opens the Code tab -->
      <TabsContent value="files" class="m-0 min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="p-2">
            <p
              class="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Changed files · click to open
            </p>
            <template v-for="f in tree" :key="f.path">
              <div
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground"
              >
                <Folder class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ f.name }}</span>
                <span v-if="f.children" class="ml-auto text-xs text-muted-foreground tabular-nums">
                  {{ f.children.length }}
                </span>
              </div>
              <div
                v-for="c in f.children ?? []"
                :key="c.path"
                role="button"
                tabindex="0"
                :class="[
                  'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 pl-6 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  file?.path === c.path && 'bg-accent text-foreground',
                ]"
                @click="openFile(c)"
                @keydown.enter="openFile(c)"
              >
                <FileCode2 class="size-3.5 shrink-0" />
                <span class="truncate">{{ c.name }}</span>
              </div>
            </template>
            <div
              v-for="f in tree.filter((x) => !x.children)"
              :key="f.path"
              role="button"
              tabindex="0"
              :class="[
                'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                file?.path === f.path && 'bg-accent text-foreground',
              ]"
              @click="openFile(f)"
              @keydown.enter="openFile(f)"
            >
              <FileCode2 class="size-3.5 shrink-0" />
              <span class="truncate">{{ f.name }}</span>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <!-- Code — mock Monaco surface: file preview the file-tree click opened -->
      <TabsContent value="code" class="m-0 flex min-h-0 flex-1 flex-col">
        <template v-if="file">
          <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <FileCode2 class="size-3.5 text-muted-foreground" />
            <span class="truncate text-xs text-muted-foreground">{{ file.path }}</span>
            <span class="flex-1" />
            <Button
              variant="ghost"
              size="iconSm"
              class="size-6"
              aria-label="Copy file content"
              @click="copyCode"
            >
              <Check v-if="copied" class="text-success" />
              <Copy v-else />
            </Button>
          </div>
          <ScrollArea class="flex-1">
            <pre class="flex min-w-max px-0 py-2 font-mono text-xs leading-relaxed">
              <code
                v-for="(l, i) in codeLines"
                :key="i"
                class="flex"
              ><span class="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground/50">{{ i + 1 }}</span><span class="whitespace-pre text-foreground/90">{{ l }}</span></code>
            </pre>
          </ScrollArea>
        </template>
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
        >
          <FileCode2 class="size-5" />
          <p class="text-sm">Pick a file in the Files tab</p>
        </div>
      </TabsContent>

      <!-- Diff — WorkspaceDiff parity: branch header + session-touched file
           list (status letter + path + +/- counts), click → PreviewModal -->
      <TabsContent value="diff" class="m-0 flex min-h-0 flex-1 flex-col">
        <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <GitBranch class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium text-foreground">feat/shadcn-migration</span>
          <span class="text-xs text-muted-foreground tabular-nums">
            ↑2 · {{ changed.length }} changed
          </span>
          <Button variant="ghost" size="iconSm" class="ml-auto size-6" aria-label="Open Git">
            <SquareArrowOutUpRight />
          </Button>
        </div>
        <ScrollArea class="flex-1">
          <Button
            v-for="f in changed"
            :key="f.path"
            variant="ghost"
            class="h-auto p-0 flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-accent"
            @click="openChanged(f)"
          >
            <span
              :class="[
                'w-3 shrink-0 font-semibold',
                f.status === 'A' && 'text-success',
                f.status === 'M' && 'text-warning',
                f.status === 'D' && 'text-destructive',
              ]"
            >
              {{ f.status }}
            </span>
            <span class="min-w-0 flex-1 truncate text-foreground/90">{{ f.path }}</span>
            <span class="flex shrink-0 gap-1.5 tabular-nums">
              <span v-if="f.additions" class="text-success">+{{ f.additions }}</span>
              <span v-if="f.deletions" class="text-destructive">−{{ f.deletions }}</span>
            </span>
          </Button>
        </ScrollArea>
      </TabsContent>

      <!-- Terminal -->
      <TabsContent value="term" class="m-0 min-h-0 flex-1">
        <div class="h-full overflow-auto bg-muted/50 p-3 font-mono text-xs leading-relaxed">
          <p class="text-muted-foreground">
            <span class="text-success">➜</span>
            pnpm typecheck
          </p>
          <p class="text-foreground/80">$ vue-tsc --noEmit</p>
          <p class="text-success">✓ 0 errors — 128 files checked</p>
          <p class="pt-2 text-muted-foreground">
            <span class="text-success">➜</span>
            pnpm lint
          </p>
          <p class="text-foreground/80">$ eslint . && prettier --check .</p>
          <p class="text-warning">⚠ 13 warnings (require-default-prop on optional `class`)</p>
          <p class="text-success">✓ 0 errors</p>
          <p class="pt-2 text-muted-foreground">▌</p>
        </div>
      </TabsContent>

      <!-- Preview — render đầu ra HTML/markdown của artifact (kiểu PreviewModal) -->
      <TabsContent value="preview" class="m-0 min-h-0 flex-1">
        <ScrollArea class="h-full">
          <div class="flex flex-col gap-3 p-4">
            <div class="flex items-center gap-2">
              <Eye class="size-3.5 text-muted-foreground" />
              <span class="text-xs text-muted-foreground">
                artifact preview · migration-note.md
              </span>
              <Badge variant="outline" class="ml-auto">markdown</Badge>
            </div>
            <div class="rounded-lg border border-border bg-card p-4">
              <h4 class="text-sm font-semibold text-foreground">shadcn-vue migration</h4>
              <p class="mt-1 text-sm leading-relaxed text-foreground/80">
                Theme layer giờ là một file CSS duy nhất khai
                <code class="rounded bg-muted px-1 font-mono text-xs">--background</code>
                …
                <code class="rounded bg-muted px-1 font-mono text-xs">--sidebar-accent</code>
                . Component chỉ đọc tên var chuẩn — production alias ngược về token AWOG mà không
                động vào class.
              </p>
              <ul class="mt-2 list-disc pl-4 text-sm text-foreground/80">
                <li>Neutral oklch palette, Light / Dark / System</li>
                <li>Sidebar icon-collapse đúng nguyên mẫu shadcn</li>
                <li>ContextMenu + Dialog + Resizable = reka thật</li>
              </ul>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <!-- Browser — mock BrowserPanel: URL bar + viewport sạch -->
      <TabsContent value="browser" class="m-0 flex min-h-0 flex-1 flex-col">
        <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Button variant="ghost" size="iconSm" class="size-6" aria-label="Back">
            <ArrowLeft />
          </Button>
          <Button variant="ghost" size="iconSm" class="size-6" aria-label="Forward">
            <ArrowRight />
          </Button>
          <Button variant="ghost" size="iconSm" class="size-6" aria-label="Reload">
            <RotateCw />
          </Button>
          <div
            class="mx-1 flex h-6 flex-1 items-center gap-1.5 rounded-md border border-border bg-muted px-2"
          >
            <Lock class="size-3 text-muted-foreground" />
            <span class="truncate font-mono text-xs text-muted-foreground">
              localhost:3031/proto/sessions
            </span>
          </div>
          <Button variant="ghost" size="iconSm" class="size-6" aria-label="Open externally">
            <SquareArrowOutUpRight />
          </Button>
        </div>
        <div class="flex flex-1 items-center justify-center bg-muted/30 p-6">
          <div
            class="flex w-full max-w-56 flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-sm"
          >
            <Globe class="size-6 text-muted-foreground" />
            <div>
              <p class="text-sm font-medium text-foreground">Browser panel</p>
              <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Surface WebView/CDP thật trong production — ở proto chỉ là placeholder.
              </p>
            </div>
            <Badge variant="secondary">mock</Badge>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CircleX,
  Copy,
  Eye,
  FileCode2,
  Files,
  Folder,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  Map,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  SquareArrowOutUpRight,
  SquareTerminal,
  X,
} from 'lucide-vue-next'
import type { changedFiles, ProtoFile, ProtoTask } from '~/composables/useProtoSession'
import { useProtoPreview } from '~/composables/useProtoPreview'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  tasks: ProtoTask[]
  tree: ProtoFile[]
  plan: { done: boolean; text: string }[]
  changed: typeof changedFiles
  file: ProtoFile | null
  fileContent: string
  open: boolean
  dock: 'left' | 'right' | 'bottom'
}>()

const emits = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:dock', v: 'left' | 'right' | 'bottom'): void
  (e: 'openFile', f: ProtoFile): void
}>()

// Tab + open-views live in the proto store (like production's settings store)
// so re-docking the panel doesn't remount it and lose state.
const { wsTab: tab, wsViews: openViews } = useProtoSession()
const copied = ref(false)
const preview = useProtoPreview()

const ALL_TABS = [
  { value: 'plan', label: 'Plan', icon: Map },
  { value: 'tasks', label: 'Tasks', icon: CheckCircle2 },
  { value: 'files', label: 'Files', icon: Files },
  { value: 'code', label: 'Code', icon: FileCode2 },
  { value: 'diff', label: 'Diff', icon: GitBranch },
  { value: 'term', label: 'Terminal', icon: SquareTerminal },
  { value: 'preview', label: 'Preview', icon: Eye },
  { value: 'browser', label: 'Browser', icon: Globe },
]

// Tabs can close and re-open via "+", like production's addableViews.
// Active tab auto-moves to a still-open neighbor.
const openViewList = computed(() => ALL_TABS.filter((t) => openViews.value.includes(t.value)))
const addable = computed(() => ALL_TABS.filter((t) => !openViews.value.includes(t.value)))

function closeView(v: string) {
  const i = openViews.value.indexOf(v)
  openViews.value = openViews.value.filter((x) => x !== v)
  if (tab.value === v) {
    const next = openViews.value[Math.min(i, openViews.value.length - 1)]
    tab.value = next ?? ''
  }
}
function addView(v: string) {
  openViews.value = [...openViews.value, v]
  tab.value = v
}

// Dock picker — same three options production offers on the strip's
// right-click menu (SessionWorkspacePanel DOCK_OPTS).
const DOCK_OPTS = [
  { side: 'left', label: 'Dock left', icon: PanelLeft },
  { side: 'right', label: 'Dock right', icon: PanelRight },
  { side: 'bottom', label: 'Dock bottom', icon: PanelBottom },
] as const

const codeLines = computed(() => props.fileContent.split('\n'))

function openFile(f: ProtoFile) {
  emits('openFile', f)
  tab.value = 'code'
}

// Changed-file row click → shared PreviewModal, exactly how production opens a
// touched file (fs.readFile over the workspace root) — here the mock body.
function openChanged(f: (typeof changedFiles)[number]) {
  const name = f.path.split('/').pop() || f.path
  preview.open({
    name,
    kind: 'text',
    text: f.body || `(deleted) ${f.path}`,
    meta: `${f.path} · +${f.additions} −${f.deletions}`,
  })
}

async function copyCode() {
  await navigator.clipboard.writeText(props.fileContent).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

const taskMeta: Record<ProtoTask['status'], { icon: typeof Circle; cls: string }> = {
  done: { icon: CheckCircle2, cls: 'text-success' },
  running: { icon: Loader2, cls: 'text-primary animate-spin' },
  queued: { icon: Circle, cls: 'text-muted-foreground' },
  failed: { icon: CircleX, cls: 'text-destructive' },
}
</script>
