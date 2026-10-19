<template>
  <!-- Thẻ findings — viền mảnh + bo lg trên nền trong suốt; chip mức độ tô
       destructive / warning. -->
  <div class="my-0.5 flex flex-col gap-2 rounded-lg border px-3 py-2.5">
    <div class="flex min-w-0 items-center gap-2">
      <Icon name="alert" class="size-3.5 shrink-0 text-warning" />
      <span class="text-base font-medium text-foreground">
        {{ t('sessionsSurfaces.findings.title') }}
      </span>
      <span class="text-sm text-muted-foreground tabular-nums">
        {{ t('sessionsSurfaces.findings.count', { n: rows.length }) }}
      </span>
      <span v-if="block.scope" class="min-w-0 flex-1 truncate text-right text-sm text-dim">
        {{ block.scope }}
      </span>
    </div>
    <div class="flex flex-col gap-2.5">
      <div
        v-for="(f, i) in rows"
        :key="`${f.file}-${f.line ?? 0}-${i}`"
        class="flex min-w-0 items-start gap-2.5"
      >
        <Badge
          variant="outline"
          class="shrink-0 rounded-sm px-1.5 py-px"
          :class="
            f.severity === 'blocker'
              ? 'border-destructive/45 bg-destructive/10 text-destructive'
              : f.severity === 'major'
                ? 'border-warning/45 bg-warning/10 text-warning'
                : 'text-muted-foreground'
          "
        >
          {{ severityLabel(f.severity) }}
        </Badge>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="text-base text-foreground">{{ f.summary }}</div>
          <!-- The location the model already knew. A link only when the sidecar
               confirmed the path is a readable workspace file.
               mono: file:line người dùng có thể dán sang editor. -->
          <Button
            v-if="f.linkable"
            variant="link"
            class="h-auto max-w-full self-start truncate p-0 text-left font-mono text-sm font-normal"
            :title="t('sessionsSurfaces.findings.open', { path: f.file })"
            @click="openFile(f)"
          >
            {{ location(f) }}
          </Button>
          <span
            v-else
            class="max-w-full self-start truncate font-mono text-sm text-dim"
            :title="t('sessionsSurfaces.findings.notInWorkspace')"
          >
            {{ location(f) }}
          </span>
          <div class="text-base text-muted-foreground">{{ f.failure }}</div>
          <div v-if="f.verdict" class="text-sm text-muted-foreground">
            <span class="text-foreground">{{ t('sessionsSurfaces.findings.verdict') }}</span>
            {{ f.verdict }}
          </div>
          <div v-else class="text-sm text-muted-foreground italic opacity-75">
            {{ t('sessionsSurfaces.findings.unverified') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Review findings the model reported (#8, report_findings) as a worst-first list:
// severity + summary + `file:line` + the concrete broken case, and the check the
// model ran when it said how it verified the row.
//
// Clicking a location goes through the SHARED file-preview infrastructure
// (useFilePreview → usePreview → PreviewModal, the repo's "every file read opens
// the one preview modal" rule) — no viewer of its own.
//
// KNOWN LIMIT: PreviewRef carries no line number, so the click opens the FILE, not
// the line. Adding one means widening usePreview + PreviewModal + the Monaco
// viewer, which is outside this package's file ownership; the line is still shown
// (and copyable) on the row. See docs/features/session-model-surfaces.md §6.
import {
  findingLocation,
  sortFindings,
  type Finding,
  type FindingSeverity,
  type FindingsBlock,
} from '~/composables/useSessionsData'

const props = defineProps<{ block: FindingsBlock }>()
const { t } = useI18n()
const filePreview = useFilePreview()

const rows = computed<Finding[]>(() => sortFindings(props.block.findings))

const location = (f: Finding): string => findingLocation(f)

const severityLabel = (s: FindingSeverity): string => t(`sessionsSurfaces.findings.severity.${s}`)

function openFile(f: Finding): void {
  filePreview.open(f.file)
}
</script>
