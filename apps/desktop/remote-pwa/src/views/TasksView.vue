<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronDown, Plus, TriangleAlert } from 'lucide-vue-next'
import { capabilities, projectName, projects, workflowName, workflowsFor } from '../catalog'
import { showToast } from '../store'
import { usePullToRefresh, useScrollCollapse } from '../gestures'
import {
  approvePhase,
  closeTask,
  createTask,
  loadTask,
  loadTasks,
  openTask,
  openTaskLoading,
  taskAction,
  taskList,
  taskListError,
  taskListLoading,
} from '../tasks'
import { errMsg, relTime } from '../util'
import AppSheet from '../components/AppSheet.vue'
import NavBar from '../components/NavBar.vue'
import type { RemoteTaskSummary } from '../types'

// Tasks (#18) — theo dõi, duyệt phase, dừng, và (khi desktop cho phép) chạy một
// workflow mới. Không có transcript ở đây: một task đọc bằng trạng thái phase,
// còn hội thoại thì thuộc về Sessions.

const creating = ref(false)
const busy = ref(false)
const form = ref({ projectId: '', workflowId: '', title: '', description: '' })

const scroller = ref<HTMLElement | null>(null)
const { pull, refreshing, engaged, threshold } = usePullToRefresh(scroller, loadTasks)
const collapsed = useScrollCollapse(scroller)

onMounted(() => void loadTasks())

const canCreate = computed(() => capabilities.value.unattended)
const formWorkflows = computed(() =>
  form.value.projectId ? workflowsFor(form.value.projectId) : [],
)
const formValid = computed(
  () => !!form.value.projectId && !!form.value.workflowId && form.value.description.trim().length > 0,
)

const RUNNING = new Set(['running', 'queued'])

function statusCls(status: string): string {
  if (status === 'failed' || status === 'canceled') return 'error'
  if (status === 'completed') return 'done'
  if (RUNNING.has(status)) return 'running'
  return 'idle'
}

function progress(t: RemoteTaskSummary): string {
  return `${t.donePhaseCount}/${t.phaseCount} phase`
}

async function open(id: string): Promise<void> {
  try {
    await loadTask(id)
  } catch (e) {
    showToast(errMsg(e))
  }
}

async function act(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  const task = openTask.value
  if (!task || busy.value) return
  busy.value = true
  try {
    showToast(await taskAction(action, task.id))
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    busy.value = false
  }
}

async function approve(nodeId: string): Promise<void> {
  const task = openTask.value
  if (!task || busy.value) return
  busy.value = true
  try {
    await approvePhase(task.id, nodeId)
    showToast('Đã duyệt phase')
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    busy.value = false
  }
}

async function submit(): Promise<void> {
  if (!formValid.value || busy.value) return
  busy.value = true
  try {
    await createTask({
      projectId: form.value.projectId,
      workflowId: form.value.workflowId,
      title: form.value.title.trim() || workflowName(form.value.workflowId),
      description: form.value.description.trim(),
    })
    creating.value = false
    form.value = { projectId: '', workflowId: '', title: '', description: '' }
    showToast('Đã tạo task')
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="tasks">
    <NavBar title="Tasks" large :collapsed="collapsed">
      <template #trailing>
        <button
          v-if="canCreate"
          class="navbtn"
          title="Chạy workflow"
          aria-label="Chạy workflow mới"
          @click="creating = true"
        >
          <Plus class="icn-lg" />
        </button>
      </template>
    </NavBar>

    <div ref="scroller" class="scroll">
      <div
        class="ptr"
        :style="{
          height: `${refreshing ? 44 : pull}px`,
          transition: engaged ? 'none' : 'height .18s ease',
        }"
      >
        <span v-if="refreshing" class="spin" />
        <ChevronDown v-else class="icn-md" :class="{ met: pull >= threshold }" />
      </div>

      <h1 class="big">Tasks</h1>

      <p v-if="!canCreate" class="note">
        Chỉ xem và điều khiển task đang có. Tạo task mới cần bật "chạy không cần duyệt"
        ở Settings → Devices trên máy desktop — node của task chạy không hỏi duyệt.
      </p>

      <div v-if="taskListError" class="state danger">{{ taskListError }}</div>
      <ul v-else-if="taskListLoading && !taskList.length" class="rows">
        <li v-for="i in 4" :key="i" class="row skel-row">
          <div class="skel w60" />
          <div class="skel w40" />
        </li>
      </ul>
      <div v-else-if="!taskList.length" class="state muted">Chưa có task nào.</div>

      <ul v-else class="rows">
        <li v-for="t in taskList" :key="t.id" class="row" @click="open(t.id)">
          <div class="row-top">
            <span class="title">{{ t.title }}</span>
            <span class="time muted">{{ relTime(t.createdAt) }}</span>
          </div>
          <div class="row-bot">
            <span class="badge" :class="statusCls(t.status)">{{ t.status }}</span>
            <span v-if="t.waitingApproval" class="badge awaiting">chờ duyệt</span>
            <span class="muted">{{ projectName(t.projectId) }}</span>
            <span class="muted">{{ progress(t) }}</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- Chi tiết task -->
    <AppSheet :open="!!openTask" :title="openTask?.title" @close="closeTask">
      <template v-if="openTask">
        <p class="desc">{{ openTask.description || 'Không có mô tả.' }}</p>
        <div class="row-bot meta">
          <span class="badge" :class="statusCls(openTask.status)">{{ openTask.status }}</span>
          <span class="muted">{{ projectName(openTask.projectId) }}</span>
          <span class="muted">{{ workflowName(openTask.workflowId) }}</span>
        </div>

        <ul class="phases">
          <li v-for="p in openTask.phases" :key="p.nodeId" class="phase">
            <div class="row-top">
              <span class="title">{{ p.skillName || p.nodeId }}</span>
              <span class="badge" :class="statusCls(p.status)">{{ p.status }}</span>
            </div>
            <pre v-if="p.lastOutput" class="out">{{ p.lastOutput }}</pre>
            <button
              v-if="openTask.waitingApproval === p.nodeId"
              class="btn primary"
              :disabled="busy"
              @click="approve(p.nodeId)"
            >
              Duyệt phase
            </button>
          </li>
        </ul>

        <div class="actions">
          <button class="btn" :disabled="busy" @click="act('pause')">Tạm dừng</button>
          <button class="btn" :disabled="busy" @click="act('resume')">Chạy tiếp</button>
          <button class="btn danger" :disabled="busy" @click="act('cancel')">Huỷ</button>
        </div>
        <div v-if="openTaskLoading" class="state"><span class="spin" /></div>
      </template>
    </AppSheet>

    <!-- Chạy workflow mới -->
    <AppSheet :open="creating" title="Chạy workflow" @close="creating = false">
      <p class="warn-box">
        <TriangleAlert class="icn-sm" />
        Task chạy không có thẻ duyệt nào: mỗi node chạy Bash/Write thẳng. Trần chi phí
        do máy desktop áp (mặc định $20 · 1500 tool call · 4 giờ cho mỗi task).
      </p>
      <label class="field">
        <span>Project</span>
        <select
          :value="form.projectId"
          @change="
            form = {
              ...form,
              projectId: ($event.target as HTMLSelectElement).value,
              workflowId: '',
            }
          "
        >
          <option value="">Chọn project</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>Workflow</span>
        <select
          :value="form.workflowId"
          :disabled="!form.projectId"
          @change="form = { ...form, workflowId: ($event.target as HTMLSelectElement).value }"
        >
          <option value="">Chọn workflow</option>
          <option v-for="w in formWorkflows" :key="w.id" :value="w.id">
            {{ w.name }} · {{ w.nodeCount }} node
          </option>
        </select>
      </label>
      <label class="field">
        <span>Tiêu đề</span>
        <input v-model="form.title" type="text" placeholder="Theo tên workflow" />
      </label>
      <label class="field">
        <span>Mô tả (đây là đề bài cho agent)</span>
        <textarea v-model="form.description" rows="5" placeholder="Việc cần làm…" />
      </label>
      <button class="btn primary wide" :disabled="!formValid || busy" @click="submit">
        Chạy
      </button>
    </AppSheet>
  </div>
</template>

<style scoped>
.tasks {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.note,
.warn-box {
  margin: 0 16px 12px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.warn-box {
  margin: 0 0 14px;
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 10%, transparent);
  color: var(--warn);
}
/* Inline with the sentence, so it rides the text baseline. */
.warn-box .lucide {
  vertical-align: -3px;
  margin-right: 4px;
}
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 14px;
  color: var(--text-dim);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.state.danger {
  color: var(--danger);
}
.muted {
  color: var(--text-dim);
}
/* Plain-style rows — full-bleed, hairline separators, same language as the
   session list. */
.rows {
  list-style: none;
  margin: 0;
  padding: 0 0 16px;
}
.row {
  position: relative;
  padding: 12px 16px;
}
.row:active {
  background: var(--surface-2);
}
.row::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
}
.row:last-child::after {
  display: none;
}
.row-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex-shrink: 0;
}
.row-bot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.meta {
  margin-bottom: 12px;
}
.badge {
  padding: 2px 8px;
  border-radius: var(--r-xs);
  background: var(--surface-3);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.badge.running {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.badge.awaiting {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.badge.error {
  background: color-mix(in srgb, var(--danger) 22%, transparent);
  color: var(--danger);
}
.desc {
  margin: 0 0 10px;
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  white-space: pre-wrap;
}
.phases {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
}
.phase {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.out {
  margin: 8px 0 0;
  padding: 8px 10px;
  max-height: 160px;
  overflow: auto;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  /* mono-ok: the phase's raw stdout tail. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}
.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: var(--tap);
  padding: 11px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.btn:active {
  background: var(--surface-3);
}
.btn:disabled {
  opacity: 0.5;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  margin-top: 8px;
}
.btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.btn.wide {
  width: 100%;
}
.field {
  display: block;
  margin-bottom: 14px;
}
.field > span {
  display: block;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  margin-bottom: 6px;
}
.field select,
.field input,
.field textarea {
  width: 100%;
  min-height: var(--tap);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px 12px;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-family: inherit;
  resize: vertical;
}
.skel-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  padding-bottom: 14px;
}
.skel-row .skel {
  height: 14px;
}
.w60 {
  width: 60%;
}
.w40 {
  width: 40%;
}
</style>
