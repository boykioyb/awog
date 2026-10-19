<template>
  <!-- "Hôm nay bạn đã làm" — CỘT PHẢI của màn Ngày (theo artifact), chứa việc AWOG TỰ
       ĐO được trong ngày: phiên chat có hoạt động + task tạo trong ngày, CHỈ của dự án
       đã nối PMS (sidecar lọc sẵn). Bấm một thẻ là đổ dự án + việc vào form nhanh bên
       trái, người dùng chốt giờ bằng nút ± rồi bấm "Thêm dòng". Nguồn cố ý KHÔNG mang
       `hours` (xem `LogtimeSuggestion`) nên KHÔNG có "→ 2.5h" hay "+ Thêm 2.5h" như bản
       phác tĩnh — bịa một con số ở đây là đẩy phỏng đoán lên PMS như giờ công thật.
       Cột rộng 272px (w-68) khớp bản phác; hẹp hơn thì tiêu đề việc bị cắt sớm. Panel
       ≤1120px thì rail thôi làm cột: xuống dưới nội dung ngày, viền trái đổi thành viền
       trên, và thôi cuộn riêng — cha (LogtimeDay) lúc này cuộn cả khối. -->
  <aside
    v-if="hasSuggestions"
    class="flex w-68 min-w-0 shrink-0 flex-col overflow-hidden border-l bg-sidebar max-[1120px]:w-auto max-[1120px]:overflow-visible max-[1120px]:border-t max-[1120px]:border-l-0"
  >
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-3">
      <Icon name="sparkles" class="size-3.5 shrink-0 text-dim" />
      <span class="min-w-0 text-sm font-semibold">{{ t('logtime.suggest.title') }}</span>
      <Badge
        v-if="pendingSuggestions > 0"
        variant="outline"
        class="rounded-sm border-warning/40 text-warning"
      >
        {{ t('logtime.suggest.pending', { n: pendingSuggestions }) }}
      </Badge>
      <Badge
        v-else-if="suggestionRows.length > 0"
        variant="outline"
        class="rounded-sm border-primary/40 bg-primary/10 text-primary"
      >
        {{ t('logtime.suggest.allLogged') }}
      </Badge>
      <span class="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        class="size-5.5 shrink-0 text-faint"
        :disabled="store.busy"
        :title="t('logtime.suggest.reload')"
        @click="loadSuggestions"
      >
        <Icon name="refresh" />
      </Button>
    </div>

    <div
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-3 pb-4 max-[1120px]:flex-none max-[1120px]:overflow-visible"
    >
      <!-- Nạp hỏng thì phải NÓI RA. Nuốt lỗi ở đây thì một lần RPC hỏng trông y hệt một
           ngày không làm gì — đúng cái người dùng không thể phân biệt được. -->
      <p v-if="store.suggestionsError" class="flex items-center gap-1.5 text-sm text-destructive">
        <Icon name="alert" class="size-3.5 shrink-0" />
        <span>{{ t('logtime.suggest.failed') }}</span>
      </p>

      <!-- Đang ở form = accent-tint (cùng ngôn ngữ với hàng đang sửa); đã khai rồi thì
           vẫn nằm đó, chỉ mờ đi. -->
      <div
        v-for="row in suggestionRows"
        :key="`${row.suggestion.kind}:${row.suggestion.refId}`"
        class="min-w-0 rounded-lg border px-3 py-2.5"
        :class="[
          row.staged ? 'border-selected-border bg-selected' : 'bg-muted',
          { 'opacity-55': row.logged },
        ]"
      >
        <div class="mb-1.5 flex min-w-0 items-center gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0"
          >
            <span>{{ row.kindLabel }}</span>
          </span>
          <!-- Màu chấm là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style. -->
          <i class="size-2 shrink-0 rounded-full" :style="{ background: row.color }" />
          <span class="min-w-0 truncate text-xs text-dim">{{ row.project }}</span>
          <span class="flex-1" />
          <span v-if="row.clock" class="shrink-0 text-xs tabular-nums text-faint">
            {{ row.clock }}
          </span>
          <!-- Mở phiên nguồn (chỉ gợi ý từ phiên; gợi ý từ task không có phiên). -->
          <Button
            v-if="row.suggestion.kind === 'session'"
            type="button"
            variant="ghost"
            size="iconSm"
            class="size-5.5 shrink-0 text-faint [&_svg]:size-3"
            :title="t('logtime.suggest.openSession')"
            :aria-label="t('logtime.suggest.openSession')"
            @click="openSession(row.suggestion)"
          >
            <Icon name="external" />
          </Button>
        </div>

        <div class="mb-2 text-base font-medium break-words">{{ row.suggestion.title }}</div>

        <div class="flex flex-wrap items-center gap-1.5">
          <!-- Đã khai / đang ở form: giữ thẻ nằm đó (biến mất thì không phân biệt được
               "đã ăn" với "panel hỏng"), chỉ đổi trạng thái nút thành nhãn. -->
          <span v-if="row.logged" class="inline-flex flex-1 items-center gap-1 text-xs text-faint">
            <Icon name="check" class="size-3 shrink-0" />
            <span>{{ t('logtime.suggest.logged') }}</span>
          </span>
          <span
            v-else-if="row.composing"
            class="inline-flex flex-1 items-center gap-1 text-xs text-primary"
          >
            <Icon name="refresh" class="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
            <span>{{ t('logtime.suggest.composing') }}</span>
          </span>
          <span
            v-else-if="row.staged"
            class="inline-flex flex-1 items-center gap-1 text-xs text-primary"
          >
            {{ t('logtime.suggest.staged') }}
          </span>
          <Button
            v-else
            type="button"
            variant="outline"
            size="xs"
            class="min-w-0 flex-1 gap-1 text-sm font-normal text-dim hover:border-selected-border hover:bg-selected hover:text-primary [&_svg]:size-3"
            @click="useSuggestion(row.suggestion)"
          >
            <Icon name="plus" />
            <span>{{ t('logtime.suggest.add') }}</span>
          </Button>

          <a
            v-if="row.issueUrl"
            class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0 hover:text-foreground"
            :href="row.issueUrl"
            target="_blank"
            rel="noopener"
            :title="t('logtime.row.openIssue', { n: row.suggestion.issue ?? 0 })"
          >
            <Icon name="link" />
            <span>#{{ row.suggestion.issue }}</span>
          </a>
          <span
            v-else-if="row.suggestion.issue !== undefined"
            class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0"
          >
            <span>#{{ row.suggestion.issue }}</span>
          </span>
        </div>
      </div>

      <!-- Việc ở dự án CHƯA nối PMS: sidecar không dựng thành thẻ (dòng thêm ra không
           đẩy được), nhưng phải nói ra — giấu đi thì người dùng tưởng hôm đó không làm
           gì. Nối dự án ở tab Thiết lập là hết. -->
      <p v-if="store.suggestionsUntracked > 0" class="text-xs text-faint">
        {{ t('logtime.suggest.untracked', { n: store.suggestionsUntracked }) }}
      </p>
      <!-- Việc CÓ thật nhưng không thuộc dự án nào nên không dựng nổi dòng công. -->
      <p v-if="store.suggestionsSkipped > 0" class="text-xs text-faint">
        {{ t('logtime.suggest.skipped', { n: store.suggestionsSkipped }) }}
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import Button from '~/components/ui/button/Button.vue'

// Không prop, không emit: state sống ở singleton cấp module (xem `useLogtimeManager`),
// nên component con tự gọi thay vì nhận prop từ `LogtimeDay` — cùng lối với `LogtimeRow`.
const { t } = useI18n()
const {
  store,
  suggestionRows,
  pendingSuggestions,
  hasSuggestions,
  useSuggestion,
  openSession,
  loadSuggestions,
} = useLogtimeManager()
</script>
