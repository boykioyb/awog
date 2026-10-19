<template>
  <div class="flex flex-col gap-2.5">
    <Button
      variant="ghost"
      size="xs"
      class="gap-1 self-start pl-1 font-normal text-muted-foreground [&_svg]:size-3.5"
      @click="emit('back')"
    >
      <Icon name="chev-left" />
      {{ t('connectionsDiscover.detail.back') }}
    </Button>

    <div class="flex flex-wrap items-center gap-2">
      <span class="text-lg font-semibold text-foreground">{{ entry.title }}</span>
      <Badge variant="outline" :class="installBadgeClass">{{ installBadge }}</Badge>
      <Badge v-if="entry.version" variant="secondary">{{ entry.version }}</Badge>
    </div>
    <p v-if="entry.description" class="m-0 text-sm leading-relaxed text-muted-foreground">
      {{ entry.description }}
    </p>
    <!-- Tên gói registry là định danh kỹ thuật ⇒ mono. -->
    <p class="m-0 font-mono text-xs break-all text-dim">{{ entry.name }}</p>

    <!-- Cảnh báo đọc-trước-khi-đồng-ý. Đây là điểm người dùng nhìn thấy CHÍNH XÁC
         thứ sẽ chạy; không có bước nào trước đó ghi hay khởi chạy gì. -->
    <p
      class="m-0 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
    >
      {{ t('connectionsDiscover.detail.review') }}
    </p>

    <template v-if="entry.install.kind === 'remote'">
      <div class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5">
        <span class="text-xs text-muted-foreground">
          {{ t('connectionsDiscover.detail.transport') }}
        </span>
        <span class="font-mono text-sm break-all text-foreground">
          {{ entry.install.transport }}
        </span>
      </div>
      <div class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5">
        <span class="text-xs text-muted-foreground">{{ t('connectionsDiscover.detail.url') }}</span>
        <span class="font-mono text-sm break-all text-foreground">{{ entry.install.url }}</span>
      </div>
    </template>

    <template v-else-if="entry.install.kind === 'stdio'">
      <div class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5">
        <span class="text-xs text-muted-foreground">
          {{ t('connectionsDiscover.detail.command') }}
        </span>
        <!-- mono-ok: dòng lệnh thật sự sẽ chạy — người dùng copy được vào terminal -->
        <span class="font-mono text-sm break-all text-foreground">{{ commandLine }}</span>
      </div>
      <div
        v-if="entry.install.envKeys.length"
        class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5"
      >
        <span class="text-xs text-muted-foreground">{{ t('connectionsDiscover.detail.env') }}</span>
        <span class="flex flex-wrap items-baseline gap-1.5 text-sm break-all text-foreground">
          <Badge
            v-for="k in entry.install.envKeys"
            :key="k"
            variant="secondary"
            class="font-mono text-muted-foreground"
          >
            {{ k }}
          </Badge>
          <span class="text-xs leading-relaxed text-muted-foreground">
            {{ t('connectionsDiscover.detail.envNote') }}
          </span>
        </span>
      </div>
    </template>

    <p v-else class="m-0 text-sm leading-relaxed text-muted-foreground">
      {{ t('connectionsDiscover.detail.unsupported', { reason: entry.install.reason }) }}
    </p>

    <div v-if="entry.secretFields.length" class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5">
      <span class="text-xs text-muted-foreground">
        {{ t('connectionsDiscover.detail.secrets') }}
      </span>
      <span class="flex flex-wrap items-baseline gap-1.5 text-sm break-all text-foreground">
        <Badge v-for="k in entry.secretFields" :key="k" variant="warning" class="font-mono">
          {{ k }}
        </Badge>
      </span>
    </div>

    <div v-if="repoUrl" class="grid grid-cols-[8rem_1fr] items-baseline gap-2.5">
      <span class="text-xs text-muted-foreground">{{ t('connectionsDiscover.detail.repo') }}</span>
      <Button
        variant="link"
        class="h-auto justify-start gap-1 p-0 text-left font-mono font-normal break-all whitespace-normal [&_svg]:size-3"
        @click="openRepo"
      >
        {{ repoUrl }}
        <Icon name="external" />
      </Button>
    </div>

    <div class="flex items-center justify-between gap-3 border-t pt-2.5">
      <span class="text-xs leading-relaxed text-muted-foreground">
        {{ t('connectionsDiscover.detail.verifyHint') }}
      </span>
      <div v-if="installable" class="flex flex-none items-center gap-3">
        <Button variant="link" class="h-auto p-0 font-normal" @click="emit('use', entry.id)">
          {{ t('connectionsDiscover.detail.customize') }}
        </Button>
        <Button variant="default" @click="emit('connect', entry)">
          {{ t('connectionsDiscover.detail.connect') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chi tiết một entry MCP Registry (gói #38) — màn hình ĐỒNG Ý.
//
// Đây là chỗ duy nhất mà nội dung bên thứ ba được trình bày đầy đủ trước khi nó
// chạm vào bất cứ thứ gì: lệnh + toàn bộ argument, hoặc URL, kèm danh sách biến
// môi trường (gieo rỗng) và khoá bí mật sẽ phải tự điền.
//
// Hai đường ra:
//  - "Kết nối" (`connect`): quick-connect — upsert → hỏi đúng các khoá còn thiếu
//    → test → OAuth nếu cần, không qua editor. Vẫn không có gì được ghi/spawn
//    cho tới cú bấm này.
//  - "Tuỳ chỉnh" (`use`): mở ConnectionEditor với bản nháp để sửa tay trước khi
//    lưu — đường cũ, giữ nguyên cho use-case nâng cao.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { RegistryEntry } from '~/stores/connections'

const props = defineProps<{ entry: RegistryEntry }>()
const emit = defineEmits<{
  back: []
  use: [id: string]
  connect: [entry: RegistryEntry]
}>()

const { t } = useI18n()

const installable = computed(() => props.entry.install.kind !== 'unsupported')

const installBadge = computed(() => {
  const kind = props.entry.install.kind
  if (kind === 'remote') return t('connectionsDiscover.badge.remote')
  if (kind === 'stdio') return t('connectionsDiscover.badge.stdio')
  return t('connectionsDiscover.badge.unsupported')
})
// Không cài được = cảnh báo vàng; cài được = accent-tint của brand.
const installBadgeClass = computed(() =>
  props.entry.install.kind === 'unsupported'
    ? 'border-transparent bg-warning/15 text-warning'
    : 'border-selected-border bg-selected text-primary',
)

// Dòng lệnh hiển thị = đúng những gì sẽ được spawn dạng mảng (không qua shell).
const commandLine = computed(() => {
  const install = props.entry.install
  if (install.kind !== 'stdio') return ''
  return [install.command, ...install.args].join(' ')
})

// Chỉ nhận https. URL đến từ registry (L1) nên không mở thứ có scheme lạ.
const repoUrl = computed(() => {
  const raw = props.entry.repositoryUrl
  if (!raw) return ''
  try {
    return new URL(raw).protocol === 'https:' ? raw : ''
  } catch {
    return ''
  }
})

const openRepo = () => {
  if (repoUrl.value) void useLinkOpen().openLink(repoUrl.value)
}
</script>
