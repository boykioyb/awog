<template>
  <div class="flex h-full flex-col">
    <!-- Project tab strip: collapse-list toggle + scrollable tabs + close × + open-project -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Toggle session list"
            :class="listCollapsed && 'bg-accent text-accent-foreground'"
            @click="listCollapsed = !listCollapsed"
          >
            <PanelLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ listCollapsed ? 'Show session list' : 'Collapse session list' }}
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" class="mx-1 h-4" />

      <Tabs v-model="activeTab" class="min-w-0 flex-1">
        <TabsList class="h-8 w-full justify-start gap-0.5 overflow-x-auto bg-transparent p-0">
          <ContextMenu v-for="p in tabProjects" :key="p.id">
            <ContextMenuTrigger>
              <TabsTrigger
                :value="p.id"
                class="group/tab h-7 shrink-0 gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:bg-accent data-[state=active]:shadow-none"
              >
                <span class="size-2 shrink-0 rounded-full" :style="{ background: p.color }" />
                {{ p.name }}
                <span
                  role="button"
                  tabindex="-1"
                  aria-label="Close project tab"
                  class="ml-0.5 flex size-3.5 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-accent-foreground/15 group-hover/tab:opacity-100"
                  @click.stop.prevent="closeProject(p.id)"
                >
                  <X class="size-2.5" />
                </span>
              </TabsTrigger>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem @click="activeTab = p.id">
                <FolderOpen />
                Activate
              </ContextMenuItem>
              <ContextMenuItem @click="closeProject(p.id)">
                <X />
                Close tab
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @click="closeOthers(p.id)">
                <X />
                Close others
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </TabsList>
      </Tabs>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Open project"
            @click="openProjectDialog = true"
          >
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open project…</TooltipContent>
      </Tooltip>
    </div>

    <!-- Open-project dialog -->
    <Dialog v-model:open="openProjectDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open project</DialogTitle>
          <DialogDescription>
            Pick a project to pin it as a tab. Existing tabs stay open.
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-0.5 py-1">
          <button
            v-for="p in projects"
            :key="p.id"
            :disabled="openTabs.includes(p.id)"
            :class="[
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              openTabs.includes(p.id)
                ? 'cursor-default text-muted-foreground'
                : 'text-foreground hover:bg-accent',
            ]"
            @click="pickProject(p.id)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: p.color }" />
            <span class="flex-1 truncate">{{ p.name }}</span>
            <Badge v-if="openTabs.includes(p.id)" variant="secondary">open</Badge>
            <span class="text-xs text-muted-foreground tabular-nums">
              {{ projectSessionCount(p.id) }} sessions
            </span>
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="openProjectDialog = false">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ResizablePanelGroup direction="horizontal" class="min-h-0 flex-1">
      <!-- Collapsed: thin rail with expand affordance (mirrors SessionTabBar listCollapsed) -->
      <div
        v-if="listCollapsed"
        class="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Expand session list"
              @click="listCollapsed = false"
            >
              <PanelLeftOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Show session list</TooltipContent>
        </Tooltip>
        <Separator class="my-1" />
        <Tooltip v-for="s in tabSessions.slice(0, 6)" :key="s.id">
          <TooltipTrigger as-child>
            <button
              :class="[
                'flex size-7 items-center justify-center rounded-md transition-colors',
                s.id === activeId ? 'bg-accent' : 'hover:bg-accent/50',
              ]"
              :aria-label="s.title"
              @click="activeId = s.id"
            >
              <component :is="railMeta[s.status]" :class="['size-3.5', railCls[s.status]]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ s.title }}</TooltipContent>
        </Tooltip>
      </div>

      <template v-else>
        <ResizablePanel :default-size="22" :min-size="16" :max-size="40">
          <ProtoSessionList
            :sessions="tabSessions"
            :active-id="activeId"
            :search="search"
            @select="activeId = $event"
            @update:search="search = $event"
          />
        </ResizablePanel>
        <ResizableHandle />
      </template>

      <!-- LEFT dock — workspace panel sits between the list and the chat -->
      <template v-if="workspaceOpen && wsDock === 'left'">
        <ResizablePanel :default-size="24" :min-size="18" :max-size="40">
          <ProtoWorkspace
            v-model:open="workspaceOpen"
            v-model:dock="wsDock"
            :tasks="tasks"
            :tree="fileTree"
            :plan="planItems"
            :changed="changedFiles"
            :file="previewFile"
            :file-content="previewContent"
            @open-file="previewFile = $event"
          />
        </ResizablePanel>
        <ResizableHandle />
      </template>

      <ResizablePanel :default-size="workspaceOpen && wsDock === 'right' ? 50 : 78" :min-size="30">
        <!-- BOTTOM dock — nest a vertical splitter inside the chat column so the
             panel takes the full column width (the narrow-screen escape). -->
        <ResizablePanelGroup
          v-if="workspaceOpen && wsDock === 'bottom'"
          direction="vertical"
          class="h-full"
        >
          <ResizablePanel :min-size="35">
            <ProtoSessionDetail />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel :default-size="32" :min-size="18">
            <ProtoWorkspace
              v-model:open="workspaceOpen"
              v-model:dock="wsDock"
              :tasks="tasks"
              :tree="fileTree"
              :plan="planItems"
              :changed="changedFiles"
              :file="previewFile"
              :file-content="previewContent"
              @open-file="previewFile = $event"
            />
          </ResizablePanel>
        </ResizablePanelGroup>
        <ProtoSessionDetail v-else />
      </ResizablePanel>

      <!-- RIGHT dock (default) -->
      <template v-if="workspaceOpen && wsDock === 'right'">
        <ResizableHandle />
        <ResizablePanel :default-size="28" :min-size="18" :max-size="45">
          <ProtoWorkspace
            v-model:open="workspaceOpen"
            v-model:dock="wsDock"
            :tasks="tasks"
            :tree="fileTree"
            :plan="planItems"
            :changed="changedFiles"
            :file="previewFile"
            :file-content="previewContent"
            @open-file="previewFile = $event"
          />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>

    <!-- Shared preview modal — one instance for the whole screen; any chip
         (message attachments, composer attachments, turn fullscreen) opens it
         via useProtoPreview(). Same pattern as common/PreviewModal.vue. -->
    <ProtoPreviewModal />
  </div>
</template>

<script setup lang="ts">
// /proto/sessions — shadcn-refactor preview of the Sessions screen.
// Same information architecture as pages/sessions.vue (project tab strip +
// resizable session list + detail + workspace panel), rebuilt on the
// components/ui primitives + the tailwind token bridge.
import { ref } from 'vue'
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  FolderOpen,
  Loader2,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  X,
} from 'lucide-vue-next'

definePageMeta({ layout: 'proto' })

const {
  projects,
  activeTab,
  openTabs,
  tabProjects,
  openProject,
  closeProject,
  activeId,
  search,
  tabSessions,
  workspaceOpen,
  wsDock,
  listCollapsed,
  previewFile,
  previewContent,
  tasks,
  fileTree,
  planItems,
  changedFiles,
  sessions,
} = useProtoSession()

const openProjectDialog = ref(false)

function pickProject(id: string) {
  openProject(id)
  openProjectDialog.value = false
}
function closeOthers(id: string) {
  for (const t of [...openTabs.value]) if (t !== id) closeProject(t)
}
function projectSessionCount(id: string) {
  return sessions.filter((s) => s.projectId === id).length
}

const railMeta = { running: Loader2, waiting: CircleDot, done: CircleCheck, error: CircleAlert }
const railCls = {
  running: 'text-primary animate-spin',
  waiting: 'text-warning',
  done: 'text-success',
  error: 'text-destructive',
}
</script>
