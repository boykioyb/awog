<template>
  <div class="flex h-full flex-col bg-background">
    <div class="flex items-center gap-1.5 p-2">
      <div class="relative flex-1">
        <Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="query"
          placeholder="Search sessions…"
          class="h-[var(--ctrl-h-sm)] border-transparent bg-muted pl-8 shadow-none focus-visible:ring-1"
        />
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="iconSm" aria-label="New session" @click="emits('new')">
            <SquarePen />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New session</TooltipContent>
      </Tooltip>
    </div>

    <ScrollArea class="flex-1">
      <div class="flex flex-col gap-0.5 p-2 pt-0">
        <ContextMenu v-for="s in sessions" :key="s.id">
          <ContextMenuTrigger>
            <div
              role="button"
              tabindex="0"
              :class="[
                'group/item relative flex w-full cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                s.id === activeId ? 'bg-accent' : 'hover:bg-accent/50',
              ]"
              @click="emits('select', s.id)"
              @keydown.enter="emits('select', s.id)"
            >
              <span class="flex items-center gap-2">
                <component
                  :is="statusMeta[s.status].icon"
                  :class="['size-3.5 shrink-0', statusMeta[s.status].cls]"
                />
                <span class="truncate text-sm font-medium text-foreground">{{ s.title }}</span>
                <!-- Per-item ⋯ menu — same action set as the right-click menu
                     (mirrors the real list: hover affordance + context-menu parity) -->
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <span
                      role="button"
                      tabindex="-1"
                      aria-label="Session actions"
                      class="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent-foreground/10 hover:text-foreground group-hover/item:opacity-100 data-[state=open]:opacity-100"
                      @click.stop
                    >
                      <MoreHorizontal class="size-3.5" />
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom" class="w-52">
                    <template v-for="(a, i) in ctxItems" :key="i">
                      <DropdownMenuSeparator v-if="a.sep" />
                      <DropdownMenuItem
                        v-else
                        :class="
                          a.danger &&
                          'text-destructive focus:bg-destructive/10 focus:text-destructive'
                        "
                      >
                        <component :is="a.icon" />
                        {{ a.label }}
                      </DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
              <span class="flex items-center gap-2 pl-[22px] text-xs text-muted-foreground">
                <Pin v-if="s.pinned" class="size-3 shrink-0" />
                <span class="truncate">{{ s.agent }} · {{ s.model }}</span>
                <span class="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
                  <span>{{ s.tokens }}</span>
                  <span
                    v-if="s.unread"
                    class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
                  >
                    {{ s.unread }}
                  </span>
                  <span v-else>{{ s.time }}</span>
                </span>
              </span>
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent class="w-56">
            <template v-for="(a, i) in ctxItems" :key="i">
              <ContextMenuSeparator v-if="a.sep" />
              <ContextMenuItem
                v-else
                :class="
                  a.danger && 'text-destructive focus:bg-destructive/10 focus:text-destructive'
                "
              >
                <component :is="a.icon" />
                {{ a.label }}
              </ContextMenuItem>
            </template>
          </ContextMenuContent>
        </ContextMenu>

        <div
          v-if="!sessions.length"
          class="flex flex-col items-center gap-2 px-3 py-10 text-center"
        >
          <Search class="size-4 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">No sessions match</p>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Copy,
  CopyPlus,
  ExternalLink,
  EyeOff,
  Folder,
  Hash,
  Loader2,
  MoreHorizontal,
  PenLine,
  Pin,
  Save,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
} from 'lucide-vue-next'
import type { ProtoSession } from '~/composables/useProtoSession'

const props = defineProps<{
  sessions: ProtoSession[]
  activeId: string | null
  search: string
}>()

const emits = defineEmits<{
  (e: 'select', id: string): void
  (e: 'update:search', v: string): void
  (e: 'new'): void
}>()

const query = computed({
  get: () => props.search,
  set: (v: string) => emits('update:search', v),
})

const statusMeta: Record<
  ProtoSession['status'],
  { icon: typeof CircleDot; cls: string; label: string }
> = {
  running: { icon: Loader2, cls: 'text-primary animate-spin', label: 'Running' },
  waiting: { icon: CircleDot, cls: 'text-warning', label: 'Waiting' },
  done: { icon: CircleCheck, cls: 'text-success', label: 'Done' },
  error: { icon: CircleAlert, cls: 'text-destructive', label: 'Failed' },
}

// One shared action set for both surfaces (right-click ContextMenu + hover ⋯
// DropdownMenu) — mirrors SessionList.vue's ctx menu, trimmed to the subset.
const ctxItems: { sep?: true; icon?: typeof Check; label?: string; danger?: boolean }[] = [
  { icon: SquarePen, label: 'Open' },
  { icon: PenLine, label: 'Rename…' },
  { icon: Sparkles, label: 'Auto title' },
  { icon: Pin, label: 'Pin' },
  { icon: EyeOff, label: 'Archive' },
  { icon: Check, label: 'Select' },
  { icon: CopyPlus, label: 'Duplicate' },
  { icon: Save, label: 'Export…' },
  { icon: ExternalLink, label: 'Open in window' },
  { sep: true },
  { icon: Copy, label: 'Copy path' },
  { icon: Folder, label: 'Show in Finder' },
  { icon: Hash, label: 'Copy ID' },
  { sep: true },
  { icon: Trash2, label: 'Delete session', danger: true },
]
</script>
