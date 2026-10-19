<template>
  <!-- One app-lifetime host (mounted in the layout) bound to the useConfirm()
       singleton. Plain confirms reuse the shared LibraryConfirmDelete visual so
       every confirm — library deletes AND imperative confirm() callers — looks
       identical; `kind: 'infra'` payloads render the infrastructure card below. -->
  <LibraryConfirmDelete
    :open="state.open && !infra"
    :title="state.title"
    :description="state.description"
    :kind="state.kind"
    :confirm-label="state.confirmLabel"
    :cancel-label="state.cancelLabel"
    @confirm="settle(true)"
    @cancel="settle(false)"
  />

  <!-- Hộp xác nhận hạ tầng: shadcn Dialog (role=dialog ⇒ OVERLAYS đã phủ). Esc / bấm
       ngoài / nút X = huỷ qua `update:open`. z-580: confirm là lớp trên cùng — chạm
       tới được cả khi đang mở preview (480), zoom ảnh (540) hay action-menu (570). -->
  <Dialog :open="isOpen" @update:open="(v: boolean) => !v && settle(false)">
    <DialogContent
      class="z-580 flex w-120 max-w-[92vw] flex-col gap-3 bg-card p-4.5"
      :class="{ 'border-destructive ring-1 ring-destructive': isProduction }"
      :aria-label="titleText"
      @open-auto-focus.prevent
    >
      <!-- 1 — action + target -->
      <DialogHeader class="flex-row items-center gap-2 pr-8">
        <Icon
          :name="isBlocked ? 'shield' : 'alert'"
          class="size-4 shrink-0"
          :class="isDanger ? 'text-destructive' : 'text-primary'"
        />
        <DialogTitle class="text-lg font-semibold">{{ titleText }}</DialogTitle>
      </DialogHeader>

      <!-- 2 — the consequence, in plain language. Never a command line. -->
      <DialogDescription class="text-base leading-relaxed text-foreground">
        {{ consequence }}
      </DialogDescription>

      <!-- 3 — pinned context + the always-on "this gets logged" chip -->
      <div class="flex flex-wrap gap-1.5">
        <Badge
          v-if="isProduction"
          variant="outline"
          class="rounded-md border-destructive/40 bg-destructive/10 font-semibold text-destructive"
        >
          <Icon name="alert" />
          {{ t('infra.confirm.production') }}
        </Badge>
        <Badge
          v-for="chip in contextChips"
          :key="chip.key"
          variant="outline"
          class="rounded-md bg-muted font-normal text-muted-foreground"
        >
          <span class="text-dim">{{ chip.label }}</span>
          {{ chip.value }}
        </Badge>
        <Badge variant="outline" class="rounded-md bg-muted font-normal text-muted-foreground">
          <Icon name="book" />
          {{ t('infra.confirm.logged') }}
        </Badge>
      </div>

      <Alert
        v-if="isBlocked"
        variant="destructive"
        class="border-destructive/40 bg-destructive/10 px-2.5 py-2 text-sm font-semibold"
      >
        <AlertDescription class="text-destructive">
          {{ t('infra.confirm.blocked') }}
        </AlertDescription>
      </Alert>

      <!-- 4 — the command itself, collapsed -->
      <Collapsible v-model:open="techOpen" class="rounded-md border bg-muted">
        <CollapsibleTrigger
          class="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-2 text-sm text-muted-foreground"
        >
          <Icon
            name="chev-right"
            class="size-3.5 shrink-0 transition-transform"
            :class="{ 'rotate-90': techOpen }"
          />
          {{ t('infra.confirm.tech') }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <!-- mono: dòng lệnh CLI thật — người dùng copy thẳng vào terminal khi bị chặn -->
          <pre
            class="m-0 px-2.5 pb-2.5 font-mono text-sm break-all whitespace-pre-wrap text-foreground select-text"
            >{{ command }}</pre
          >
        </CollapsibleContent>
      </Collapsible>

      <div v-if="needsTyping" class="flex flex-col gap-1.5">
        <Label for="icd-type-input" class="font-normal text-muted-foreground">
          {{ t('infra.confirm.typeToConfirm', { name: typeWord }) }}
        </Label>
        <!-- Retype-to-confirm giữ focus màu DANGER — ô này là một phần của cổng chặn. -->
        <Input
          id="icd-type-input"
          ref="typeInput"
          v-model="typed"
          class="focus-visible:border-destructive focus-visible:ring-destructive"
          autocomplete="off"
          spellcheck="false"
          :placeholder="typeWord"
          @keydown.enter.prevent="onPrimary"
        />
      </div>

      <!-- 5 — footer per variant -->
      <DialogFooter>
        <template v-if="isBlocked">
          <Button variant="outline" @click="copyCommand">
            <Icon name="copy" />
            {{ copied ? t('common.copied') : t('infra.confirm.copyCommand') }}
          </Button>
          <Button ref="primaryBtn" variant="default" @click="settle(false)">
            {{ t('common.close') }}
          </Button>
        </template>
        <template v-else-if="isRead">
          <Button ref="primaryBtn" variant="default" @click="settle(true)">
            {{ t('infra.confirm.run') }}
          </Button>
        </template>
        <template v-else>
          <Button variant="outline" @click="settle(false)">{{ t('common.cancel') }}</Button>
          <Button
            ref="primaryBtn"
            :variant="isDanger ? 'destructive' : 'default'"
            :disabled="!canConfirm"
            @click="onPrimary"
          >
            {{ t('common.confirm') }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Host for both confirm shapes (see useConfirm.ts). The infra card is built here
// rather than by each caller so every infrastructure surface — Explorer buttons,
// the agent's `infra_action` gate, playbooks — asks the same question the same way
// (ADR 0088 §5, infra-explorer "Hành động ghi: luật chung"):
//   consequence in plain language → context chips → collapsed command → footer.
// The footer is the only thing the command class changes:
//   read        → one Run button        write       → Confirm + Cancel
//   destructive → retype the name first  blocked     → copy the command, no run
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'

const { state, settle } = useConfirm()
const { t } = useI18n()

const infra = computed(() => state.infra)
const isOpen = computed(() => state.open && !!infra.value)

const titleText = computed(() =>
  infra.value
    ? t('infra.confirm.title', { action: infra.value.action, target: infra.value.target })
    : '',
)
const consequence = computed(() => infra.value?.consequence ?? '')
const command = computed(() => infra.value?.command ?? '')
const isProduction = computed(() => infra.value?.accountKind === 'production')
const isBlocked = computed(() => infra.value?.blocked === true)
const isRead = computed(() => infra.value?.class === 'read')
// Red chrome for the two cases worth stopping at: a destructive class, or anything
// at all on a production account.
const isDanger = computed(() => infra.value?.class === 'destructive' || isProduction.value)

// Context chips, account first (the question people actually ask is "which
// account?"). Order is fixed so two dialogs never read differently.
const CONTEXT_KEYS = ['accountId', 'profile', 'region', 'cluster', 'namespace'] as const

const contextChips = computed(() => {
  const ctx = infra.value?.context
  if (!ctx) return []
  return CONTEXT_KEYS.filter((key) => !!ctx[key]).map((key) => ({
    key,
    label: t(`infra.confirm.ctx.${key}`),
    value: ctx[key] as string,
  }))
})

// A destructive action is never ungated: with no explicit `typeToConfirm` the
// target's own name becomes the word to retype.
const typeWord = computed(() => infra.value?.typeToConfirm || infra.value?.target || '')
const needsTyping = computed(
  () => !isBlocked.value && infra.value?.class === 'destructive' && !!typeWord.value,
)

const typed = ref('')
// Exact match (GitHub's "type the repo name" rule): a case-insensitive compare on
// resource names that differ only by case would wave through the wrong resource.
const canConfirm = computed(
  () => !isBlocked.value && (!needsTyping.value || typed.value.trim() === typeWord.value),
)

function onPrimary() {
  if (!canConfirm.value) return
  settle(true)
}

const copied = ref(false)
let copyTimer: number | undefined

async function copyCommand() {
  await navigator.clipboard.writeText(command.value)
  copied.value = true
  window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

const typeInput = useTemplateRef<{ focus: () => void }>('typeInput')
// Button shadcn là component ⇒ template ref là instance, phần tử nằm ở `$el`.
const primaryBtn = useTemplateRef<{ $el: HTMLElement }>('primaryBtn')
const techOpen = ref(false)

// Reset the per-open state, then park focus where the next keystroke belongs: the
// retype field when there is one, the safe default button otherwise. Keyed on the
// PAYLOAD, not on `isOpen`: opening a second infra confirm over a pending one keeps
// `isOpen` true the whole time, and that dialog must not inherit the first one's
// half-typed resource name.
watch(infra, (payload) => {
  if (!payload) return
  typed.value = ''
  copied.value = false
  techOpen.value = false
  // Focus tự đặt ở đây (DialogContent chặn `open-auto-focus` của reka).
  nextTick(() => (needsTyping.value ? typeInput.value?.focus() : primaryBtn.value?.$el?.focus()))
})

// Esc đóng qua reka Dialog (`update:open` → settle(false)), như LibraryConfirmDelete.
onBeforeUnmount(() => window.clearTimeout(copyTimer))
</script>
