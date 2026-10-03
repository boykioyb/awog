<template>
  <div v-if="active" class="flex h-full min-w-0 flex-col">
    <!-- Detail header — production keeps the header to title + a few controls
         (`.dh` không wrap): everything secondary lives in the ⋯ overflow so a
         narrow panel only ever shrinks the title, never breaks the row. -->
    <div
      class="flex h-11 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-3"
    >
      <h2 class="min-w-0 truncate text-sm font-semibold text-foreground">{{ active.title }}</h2>
      <Badge :variant="statusVariant[active.status]" class="shrink-0">
        {{ statusLabel[active.status] }}
      </Badge>
      <span
        class="flex min-w-0 shrink items-center gap-1 truncate text-xs whitespace-nowrap text-muted-foreground"
      >
        <UserRound class="size-3 shrink-0" />
        {{ active.agent }} · {{ active.model }}
      </span>
      <span class="min-w-2 flex-1" />
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            aria-label="Bubble mode"
            :class="bubbleMode && 'bg-accent text-accent-foreground'"
            @click="bubbleMode = !bubbleMode"
          >
            <MessagesSquare />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ bubbleMode ? 'Flat transcript' : 'Bubble mode' }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            aria-label="Toggle workspace"
            :class="workspaceOpen && 'bg-accent text-accent-foreground'"
            @click="workspaceOpen = !workspaceOpen"
          >
            <PanelRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Workspace panel</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="iconSm" class="shrink-0" aria-label="More">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <!-- Low-frequency actions live here (production parity) so they
               never fight the title for header space. -->
          <DropdownMenuItem>
            <Bookmark />
            Bookmark
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Share2 />
            Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Rename…</DropdownMenuItem>
          <DropdownMenuItem>Fork session</DropdownMenuItem>
          <DropdownMenuItem>Pop out window</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive">Delete session</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <ProtoTranscript :messages="activeMessages" :bubble="bubbleMode" />
    <ProtoComposer />
  </div>

  <!-- Empty state -->
  <div v-else class="flex h-full flex-col items-center justify-center gap-3">
    <MessageSquare class="size-6 text-muted-foreground" />
    <p class="text-sm text-muted-foreground">Select a session or start a new one</p>
    <Button size="sm">
      <Plus />
      New session
    </Button>
  </div>
</template>

<script setup lang="ts">
// Session detail column — header + transcript + composer. Extracted from the
// page so the workspace panel can dock left/right/bottom around it without
// duplicating markup. Reads the shared singleton store directly.
import {
  Bookmark,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  PanelRight,
  Plus,
  Share2,
  UserRound,
} from 'lucide-vue-next'

const { active, activeMessages, bubbleMode, workspaceOpen } = useProtoSession()

const statusVariant = {
  running: 'default',
  waiting: 'warning',
  done: 'secondary',
  error: 'destructive',
} as const
const statusLabel = {
  running: 'Running',
  waiting: 'Waiting',
  done: 'Done',
  error: 'Failed',
} as const
</script>
