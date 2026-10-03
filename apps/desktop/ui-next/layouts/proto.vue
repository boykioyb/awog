<template>
  <TooltipProvider :delay-duration="300">
    <SidebarProvider class="h-svh">
      <Sidebar>
        <SidebarHeader>
          <div
            class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <Home class="size-4" />
          </div>
          <div class="flex flex-col group-data-[collapsible=icon]/sidebar:hidden">
            <span class="text-sm font-semibold text-foreground">AWOG</span>
            <span class="text-xs text-sidebar-foreground/70">shadcn proto</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup v-for="(g, gi) in groups" :key="gi">
            <SidebarGroupLabel v-if="g.label">{{ g.label }}</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in g.items" :key="item.label">
                <SidebarMenuButton
                  :is-active="item.to === route.path"
                  :tooltip="item.label"
                  as="a"
                  :href="item.to"
                >
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="iconSm" aria-label="Activity">
                <Gauge />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Activity</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="iconSm" aria-label="Settings">
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header
          class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3"
        >
          <SidebarTrigger />
          <Separator orientation="vertical" class="!h-4" />
          <span class="text-sm font-medium text-foreground">Sessions</span>
          <Badge variant="secondary" class="ml-1">awog</Badge>
          <span class="flex-1" />
          <Button variant="outline" size="sm" class="gap-2 text-muted-foreground">
            <SquareTerminal />
            <span class="text-xs">⌘K</span>
          </Button>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="iconSm" aria-label="Notifications">
                <Bell />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>
          <!-- shadcn docs ModeToggle: light / dark / system -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="iconSm" aria-label="Toggle theme">
                <Sun v-if="!isDark" />
                <Moon v-else />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-36">
              <DropdownMenuItem v-for="o in schemes" :key="o.value" @click="setMode(o.value)">
                <component :is="o.icon" />
                {{ o.label }}
                <Check v-if="mode === o.value" class="ml-auto !text-foreground" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span
            class="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground"
          >
            K
          </span>
        </header>

        <div class="min-h-0 flex-1">
          <slot />
        </div>

        <footer
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-xs text-muted-foreground"
        >
          <span class="flex items-center gap-1.5">
            <GitBranch class="size-3" />
            main
          </span>
          <Separator orientation="vertical" class="!h-3" />
          <span>context 41.2k / 200k</span>
          <span class="flex-1" />
          <span class="tabular-nums">3 sessions · 2 running</span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
</template>

<script setup lang="ts">
// Prototype shell — shadcn dashboard template shape (SidebarProvider +
// icon-collapsible Sidebar + SidebarInset + header). The var layer is the real
// shadcn neutral theme (assets/css/proto-shadcn.css), flipped by ModeToggle.
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import {
  Bell,
  Bot,
  Check,
  FolderGit2,
  FolderKanban,
  Gauge,
  GitBranch,
  Hash,
  Home,
  ListChecks,
  MessageSquare,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  SquareTerminal,
  Sun,
  Workflow,
  Zap,
} from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useProtoTheme, type ProtoScheme } from '~/composables/useProtoTheme'

const route = useRoute()
const { mode, setMode, init, isDark } = useProtoTheme()

const schemes: { value: ProtoScheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

// The whole shadcn var set is scoped to body.proto-shadcn — mount it only while
// a proto page is on screen (portalled overlays inherit from body too).
// Race: under HMR/keepalive a STALE layout instance unmounts after this one
// mounts — its onUnmounted strips the class we just added, leaving the page on
// raw AWOG tokens. Re-assert on every route landing inside this layout.
const reassert = () => document.body.classList.add('proto-shadcn')
onMounted(() => {
  reassert()
  init()
  // …and once more after the old tree's unmount settles (same belt-and-suspenders
  // as useProtoTheme's setTimeout(apply, 0)).
  nextTick(reassert)
  setTimeout(reassert, 0)
})
watch(
  () => route.fullPath,
  () => nextTick(reassert),
)
onUnmounted(() => document.body.classList.remove('proto-shadcn'))

const groups = [
  {
    label: null,
    items: [
      { to: '/proto/sessions', icon: MessageSquare, label: 'Sessions' },
      { to: '#', icon: ListChecks, label: 'Tasks' },
      { to: '#', icon: GitBranch, label: 'Git' },
      { to: '#', icon: Workflow, label: 'Workflows' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '#', icon: FolderKanban, label: 'Projects' },
      { to: '#', icon: Bot, label: 'Agents' },
      { to: '#', icon: Zap, label: 'Skills' },
      { to: '#', icon: Hash, label: 'Commands' },
      { to: '#', icon: ScrollText, label: 'Rules' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '#', icon: FolderGit2, label: 'Connections' },
      { to: '#', icon: Gauge, label: 'Monitor' },
    ],
  },
]
</script>
