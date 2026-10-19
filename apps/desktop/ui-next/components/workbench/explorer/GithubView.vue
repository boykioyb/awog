<template>
  <!-- View "GitHub" — list PR + Issue của repo project qua gh.list (sidecar).
       Tabs PR/Issues + filter chips theo label/author; click → doc web GitHub.
       State/handlers: useGithubViewManager (composables/). -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-7.5 flex-none items-center gap-1.5 px-2.5 text-sm text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]"
    >
      <Github :size="14" />
      <b class="min-w-0 truncate font-semibold">{{ repoLabel }}</b>
      <Button
        variant="ghost"
        size="iconSm"
        class="ml-auto size-5 text-dim hover:text-foreground [&_svg]:size-3"
        title="Refresh"
        @click="refresh"
      >
        <RefreshCw :size="12" :class="{ 'animate-spin': loading }" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-5 [&_svg]:size-3"
        :class="hasFilter ? 'text-primary hover:text-primary' : 'text-dim hover:text-foreground'"
        title="Bộ lọc — state / label / author / assignee / reviewer"
        @click.stop="filterOpen = !filterOpen"
      >
        <ListFilter :size="12" />
      </Button>
    </div>

    <div v-if="filterOpen" class="fixed inset-0 z-40" @click="filterOpen = false" />
    <div
      v-if="filterOpen"
      class="absolute right-2 top-8 z-41 max-h-70 min-w-45 divide-y divide-border overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
    >
      <!-- Mỗi chiều một selectbox: header row + expand list có searchbox.
           Filter độc lập, kết hợp AND ở `filtered`. -->
      <div v-for="sec in SECS" :key="sec.key">
        <Button
          variant="ghost"
          class="h-auto w-full justify-start gap-1.5 rounded-none px-2.5 py-1.5 font-normal [&_svg]:size-3"
          :class="secOpen === sec.key ? 'text-primary' : 'text-foreground'"
          @click="toggleSec(sec.key)"
        >
          <component :is="sec.icon" :size="12" />
          <span class="flex-none">{{ sec.label }}</span>
          <span
            class="min-w-0 flex-1 truncate text-right"
            :class="filters[sec.key] ? 'font-medium text-primary' : 'text-faint'"
          >
            {{ filters[sec.key] || 'Any' }}
          </span>
          <ChevronDown v-if="secOpen === sec.key" :size="12" />
          <ChevronRight v-else :size="12" />
        </Button>
        <template v-if="secOpen === sec.key">
          <div class="flex items-center gap-1.5 border-b border-border px-2.5 py-1 text-faint">
            <Search :size="12" />
            <Input
              v-model="filterQ"
              unstyled
              class="min-h-0 min-w-0 flex-1 text-sm text-foreground"
              :placeholder="`Tìm ${sec.label.toLowerCase()}…`"
              spellcheck="false"
            />
          </div>
          <div class="max-h-50 overflow-y-auto">
            <Button
              variant="ghost"
              class="h-auto w-full justify-start gap-1.5 rounded-none px-2.5 py-1 font-normal [&_svg]:size-3"
              :class="!filters[sec.key] ? 'text-primary' : 'text-foreground'"
              @click="setFilter(sec.key, '')"
            >
              <Check v-if="!filters[sec.key]" :size="12" />
              <span v-else class="w-3 flex-none" />
              Any
            </Button>
            <Button
              v-for="o in optsOf(sec)"
              :key="sec.key + o"
              variant="ghost"
              class="h-auto w-full justify-start gap-1.5 rounded-none px-2.5 py-1 font-normal [&_svg]:size-3"
              :class="{
                'text-primary': filters[sec.key] === o,
                'text-foreground': filters[sec.key] !== o,
              }"
              @click="setFilter(sec.key, o)"
            >
              <Check v-if="filters[sec.key] === o" :size="12" />
              <span v-else class="w-3 flex-none" />
              <template v-if="sec.avatar">
                <img
                  v-if="!avFail.has(o)"
                  class="h-3.5 w-3.5 flex-none rounded-full"
                  :src="ghAvatar(o)"
                  :alt="o"
                  @error="avFail.add(o)"
                />
                <span
                  v-else
                  class="grid h-3.5 w-3.5 flex-none place-items-center rounded-full bg-primary text-[0.65em] font-semibold text-primary-foreground"
                >
                  {{ o.slice(0, 1).toUpperCase() }}
                </span>
              </template>
              {{ o }}
            </Button>
            <div
              v-if="!optsOf(sec).length"
              class="flex w-full cursor-default items-center gap-1.5 px-2.5 py-1 text-left text-sm text-faint hover:bg-accent"
            >
              Không khớp.
            </div>
          </div>
        </template>
      </div>
      <Button
        v-if="hasFilter"
        variant="ghost"
        class="mt-0.5 h-auto w-full justify-start gap-1.5 rounded-none px-2.5 pb-1 pt-1.5 font-normal text-destructive hover:text-destructive"
        @click="clearFilters"
      >
        Bỏ lọc
      </Button>
    </div>

    <Tabs :model-value="kind" class="px-2 pb-0.5 pt-1.5" @update:model-value="setKind">
      <TabsList class="h-7 w-full rounded-sm p-0.5">
        <TabsTrigger value="pr" class="h-6 flex-1 gap-1 px-2 text-xs">
          Pull request
          <span class="tabular-nums text-muted-foreground">{{ prs.length }}</span>
        </TabsTrigger>
        <TabsTrigger value="issue" class="h-6 flex-1 gap-1 px-2 text-xs">
          Issues
          <span class="tabular-nums text-muted-foreground">{{ issues.length }}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- Active-filter hiện nhanh ngay dưới tabs để biết đang lọc gì. -->
    <div v-if="activeFilters.length" class="flex flex-wrap gap-1 border-b border-border px-2 py-1">
      <Button
        v-for="c in activeFilters"
        :key="c.key"
        variant="ghost"
        class="h-5 gap-1 rounded-full border border-selected-border bg-selected px-2 text-xs font-normal text-foreground [&_svg]:size-2.5"
        @click="setFilter(c.key, '')"
      >
        {{ c.text }}
        <X :size="10" />
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2.5 pt-1 text-sm">
      <div
        v-if="banner"
        class="mx-2 mb-1.5 mt-1 flex cursor-pointer items-center gap-1.5 rounded-md border border-selected-border bg-selected px-2 py-1.5 text-xs text-muted-foreground"
        @click="openItem(banner.item)"
      >
        <CheckCircle2 :size="12" class="flex-none text-primary" />
        <span class="min-w-0 flex-1 truncate">
          <b>{{ banner.who }}</b>
          review xong · #{{ banner.item.number }}
        </span>
        <ChevronRight :size="12" class="flex-none text-faint" />
      </div>

      <div v-if="error" class="p-3.5 text-sm text-faint">{{ error }}</div>
      <div v-else-if="loading && !filtered.length" class="p-3.5 text-sm text-faint">Đang tải…</div>
      <div v-else-if="!filtered.length" class="p-3.5 text-sm text-faint">
        Không có {{ kind === 'pr' ? 'PR' : 'issue' }} nào.
      </div>
      <template v-else>
        <div
          v-for="it in filtered"
          :key="it.kind + it.number"
          class="flex min-h-9.5 cursor-pointer items-center gap-1.5 py-1 pl-3 pr-2.5 text-muted-foreground shadow-[inset_0_-1px_0_var(--border)] hover:bg-accent"
          :title="`#${it.number} ${it.title}`"
          @click="openItem(it)"
        >
          <span class="flex-none text-xs tabular-nums text-faint">#{{ it.number }}</span>
          <span class="flex min-w-0 flex-1 flex-col leading-(--lh-xs)">
            <span class="truncate">{{ it.title }}</span>
            <span v-if="it.kind === 'pr' && it.headRefName" class="truncate text-xs text-info">
              {{ it.headRefName }} → {{ it.baseRefName }}
            </span>
          </span>
          <span
            v-for="l in it.labels.slice(0, 1)"
            :key="l.name"
            class="flex-none rounded-sm px-1 text-xs"
            :class="LBL_CLS[l.name] || LBL_CLS_DEFAULT"
          >
            {{ l.name }}
          </span>
          <span class="flex-none rounded-sm px-1 text-xs" :class="stCls(it)">
            {{ stTxt(it) }}
          </span>
          <span
            class="grid h-3.5 w-3.5 flex-none place-items-center rounded-full text-[0.65em] font-semibold text-primary-foreground"
            :style="{ background: avColor(it.author.login) }"
          >
            <img
              v-if="!avFail.has(it.author.login)"
              class="size-full rounded-full object-cover"
              :src="ghAvatar(it.author.login)"
              :alt="it.author.login"
              loading="lazy"
              @error="avFail.add(it.author.login)"
            />
            <template v-else>{{ it.author.login.slice(0, 1).toUpperCase() }}</template>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Github,
  ListFilter,
  RefreshCw,
  Search,
  X,
} from 'lucide-vue-next'

const {
  kind,
  loading,
  error,
  repoLabel,
  prs,
  issues,
  filtered,
  banner,
  filters,
  filterOpen,
  secOpen,
  filterQ,
  SECS,
  LBL_CLS,
  LBL_CLS_DEFAULT,
  hasFilter,
  activeFilters,
  toggleSec,
  setFilter,
  clearFilters,
  optsOf,
  avFail,
  ghAvatar,
  avColor,
  stCls,
  stTxt,
  refresh,
  openItem,
} = useGithubViewManager()

// Tabs emit string|number — narrow về GhKind trước khi gán (reka không generic).
function setKind(v: string | number): void {
  if (v === 'pr' || v === 'issue') kind.value = v
}
</script>
