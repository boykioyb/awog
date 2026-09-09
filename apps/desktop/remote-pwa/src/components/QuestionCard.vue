<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Circle, CircleCheck } from 'lucide-vue-next'
import { answerQuestion } from '../store'
import type { SessionQuestion, SessionQuestionAnswer, SessionStep } from '../types'

const props = defineProps<{ step: SessionStep }>()

const questions = computed<SessionQuestion[]>(() => props.step.questions ?? [])
const answered = computed(() => (props.step.answers?.length ?? 0) > 0)

// Per-question selected labels, keyed by header.
const selected = reactive<Record<string, string[]>>({})

function toggle(q: SessionQuestion, label: string): void {
  const cur = selected[q.header] ?? []
  if (q.multiSelect) {
    selected[q.header] = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
  } else {
    selected[q.header] = cur.includes(label) ? [] : [label]
  }
}

function isOn(q: SessionQuestion, label: string): boolean {
  return (selected[q.header] ?? []).includes(label)
}

const canSubmit = computed(() => questions.value.every((q) => (selected[q.header] ?? []).length > 0))

function submit(): void {
  if (!canSubmit.value) return
  const answers: SessionQuestionAnswer[] = questions.value.map((q) => ({
    header: q.header,
    selected: selected[q.header] ?? [],
  }))
  answerQuestion(props.step, answers)
}
</script>

<template>
  <div class="q" :class="{ resolved: answered }">
    <div class="head"><span class="badge q-badge">Câu hỏi</span></div>

    <div v-if="answered" class="answered">
      <div v-for="(a, i) in step.answers" :key="i" class="ans">
        <span class="ah">{{ a.header }}</span>
        <span>{{ a.selected.join(', ') }}</span>
      </div>
    </div>

    <template v-else>
      <div v-for="q in questions" :key="q.header" class="block">
        <p class="prompt">{{ q.question }}</p>
        <div class="opts">
          <button
            v-for="opt in q.options"
            :key="opt.label"
            class="opt"
            :class="{ on: isOn(q, opt.label) }"
            @click="toggle(q, opt.label)"
          >
            <CircleCheck v-if="isOn(q, opt.label)" class="icn-sm mark" />
            <Circle v-else class="icn-sm mark" />
            <span class="opt-body">
              <span class="opt-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="opt-desc muted">{{ opt.description }}</span>
            </span>
          </button>
        </div>
      </div>
      <button class="btn btn-accent submit" :disabled="!canSubmit" @click="submit">Gửi</button>
    </template>
  </div>
</template>

<style scoped>
.q {
  border: 1px solid var(--warn);
  border-radius: var(--r-card);
  padding: 12px 14px;
  margin: 6px 0 12px;
  background: color-mix(in srgb, var(--warn) 7%, var(--surface));
}
.q.resolved {
  border-color: var(--border);
  background: var(--surface);
}
.head {
  margin-bottom: 8px;
}
.q-badge {
  background: color-mix(in srgb, var(--warn) 24%, transparent);
  color: var(--warn);
}
.block {
  margin-bottom: 12px;
}
.prompt {
  margin: 0 0 8px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 500;
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.opt {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: var(--tap);
  text-align: left;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  border-radius: var(--r-btn);
  /* 11 + 22 (inherited line box) + 11 = exactly --tap for a one-line option. */
  padding: 11px 12px;
}
.opt:active {
  background: var(--surface-3);
}
.opt.on {
  border-color: var(--accent);
}
.mark {
  color: var(--accent);
  /* Nudge onto the first line's optical centre (label is --lh-md = 22px). */
  margin-top: 4px;
}
.opt-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.opt-desc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ans {
  display: flex;
  gap: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 2px 0;
}
.ah {
  color: var(--text-dim);
  font-weight: 600;
}
.submit {
  width: 100%;
}
</style>
