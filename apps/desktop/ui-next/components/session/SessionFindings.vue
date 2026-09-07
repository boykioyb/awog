<template>
  <div class="fnd">
    <div class="fndhead">
      <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="fndtitle">{{ t('sessionsSurfaces.findings.title') }}</span>
      <span class="fndcount">{{ t('sessionsSurfaces.findings.count', { n: rows.length }) }}</span>
      <span v-if="block.scope" class="fndscope">{{ block.scope }}</span>
    </div>
    <div class="fndlist">
      <div v-for="(f, i) in rows" :key="`${f.file}-${f.line ?? 0}-${i}`" class="fndrow">
        <span class="fndsev" :class="f.severity">{{ severityLabel(f.severity) }}</span>
        <div class="fndmain">
          <div class="fndsum">{{ f.summary }}</div>
          <!-- The location the model already knew. A link only when the sidecar
               confirmed the path is a readable workspace file. -->
          <button
            v-if="f.linkable"
            class="fndloc link"
            :title="t('sessionsSurfaces.findings.open', { path: f.file })"
            @click="openFile(f)"
          >
            {{ location(f) }}
          </button>
          <span v-else class="fndloc" :title="t('sessionsSurfaces.findings.notInWorkspace')">
            {{ location(f) }}
          </span>
          <div class="fndfail">{{ f.failure }}</div>
          <div v-if="f.verdict" class="fndverdict">
            <span class="fndvlabel">{{ t('sessionsSurfaces.findings.verdict') }}</span>
            {{ f.verdict }}
          </div>
          <div v-else class="fndverdict unverified">
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

<style scoped>
.fnd {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
}
.fndhead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.fndhead .icn {
  flex: 0 0 auto;
  color: var(--amber);
}
.fndtitle {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.fndcount {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.fndscope {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fndlist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fndrow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.fndsev {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.fndsev.blocker {
  color: var(--danger);
  border-color: var(--dangerBorder);
  background: var(--dangerBg);
}
.fndsev.major {
  color: var(--amber);
  border-color: var(--amberBorder);
  background: var(--amberDim);
}
.fndmain {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.fndsum {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.fndloc {
  align-self: flex-start;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font-family: var(--code); /* mono-ok: a file:line the user may paste into an editor */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fndloc.link {
  color: var(--accent);
  cursor: pointer;
}
.fndloc.link:hover {
  text-decoration: underline;
}
.fndfail {
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.fndverdict {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.fndverdict.unverified {
  font-style: italic;
  opacity: 0.75;
}
.fndvlabel {
  color: var(--text);
}
</style>
