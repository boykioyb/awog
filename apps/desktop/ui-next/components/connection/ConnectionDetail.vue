<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Header card: avatar + name + tagline + meta on the left, action buttons docked
         top-right on ONE row. A floating card (matches the content cards) with the pane
         gutter around it, not a flat header bar. -->
    <Card class="mx-3.5 mt-3.5 flex-none flex-row items-start gap-3 rounded-lg p-4 shadow-none">
      <SourceAvatar :source="source" size="lg" />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="text-lg font-semibold break-words text-foreground">
          {{ source.name || source.slug }}
        </div>
        <div v-if="source.tagline" class="text-sm text-muted-foreground">{{ source.tagline }}</div>
        <div class="mt-0.5 flex flex-wrap items-center gap-2">
          <!-- Transport (stdio/http/sse…) là định danh kỹ thuật ⇒ mono. -->
          <Badge variant="outline" class="font-mono">{{ transport }}</Badge>
          <Badge variant="outline" class="gap-1.5 capitalize">
            <SourceStatusDot :status="status" :error-message="source.connectionError" />
            {{ t('connections.status.' + status) }}
          </Badge>
        </div>
      </div>
      <div class="flex flex-none items-center gap-2">
        <Button
          v-if="isOAuthSource"
          variant="outline"
          size="iconSm"
          :disabled="oauthPending"
          :title="oauthTitle"
          :aria-label="oauthTitle"
          @click="onConnectOAuth"
        >
          <Icon :name="oauthPending ? 'refresh' : 'link'" :class="oauthPending && 'animate-spin'" />
        </Button>
        <Button
          v-if="source.type === 'api'"
          variant="outline"
          size="iconSm"
          :title="t('connections.detail.setCredential')"
          :aria-label="t('connections.detail.setCredential')"
          @click="emit('edit')"
        >
          <Icon name="shield" />
        </Button>
        <Button
          variant="outline"
          size="iconSm"
          :disabled="testing"
          :title="t('connections.detail.test')"
          :aria-label="t('connections.detail.test')"
          @click="onTest"
        >
          <Icon :name="testing ? 'refresh' : 'check'" :class="testing && 'animate-spin'" />
        </Button>
        <Button
          v-if="canReveal"
          variant="outline"
          size="iconSm"
          :title="t('connections.detail.showInFolder')"
          :aria-label="t('connections.detail.showInFolder')"
          @click="emit('reveal')"
        >
          <Icon name="folder" />
        </Button>
        <Button
          variant="outline"
          size="iconSm"
          :title="t('connections.detail.edit')"
          :aria-label="t('connections.detail.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" />
        </Button>
        <Button
          variant="outline"
          size="iconSm"
          class="hover:border-destructive hover:text-destructive"
          :title="t('connections.detail.delete')"
          :aria-label="t('connections.detail.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" />
        </Button>
      </div>
    </Card>

    <!-- transient feedback (Test/OAuth live in the hero, so keep their result visible
         on every tab, not buried inside one) — fixed above the tabs. -->
    <div v-if="oauthPending || testResult" class="flex-none px-3.5">
      <!-- OAuth in-flight: the sidecar opened the browser; wait for the callback. -->
      <div
        v-if="oauthPending"
        class="mt-3.5 flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm text-muted-foreground"
      >
        <span
          class="size-3.5 flex-none animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <div class="min-w-0 flex-1">
          <div class="mb-0.5 font-semibold">{{ t('connections.detail.oauthWaitingTitle') }}</div>
          <div class="break-words">{{ t('connections.detail.oauthWaiting') }}</div>
        </div>
        <Button
          variant="outline"
          size="iconSm"
          class="hover:border-destructive hover:text-destructive"
          :title="t('connections.detail.oauthCancel')"
          :aria-label="t('connections.detail.oauthCancel')"
          @click="onCancelOAuth"
        >
          <Icon name="x" />
        </Button>
      </div>

      <!-- transient test-result banner -->
      <Alert
        v-if="testResult"
        :variant="bannerOk ? 'default' : 'destructive'"
        class="mt-3.5 px-3 py-2.5"
        :class="bannerOk ? 'border-selected-border text-primary' : 'border-destructive/40'"
      >
        <Icon :name="bannerOk ? 'check' : 'alert'" />
        <div class="col-start-2 min-w-0">
          <div class="mb-0.5 font-semibold">{{ bannerTitle }}</div>
          <div class="font-mono break-words">{{ testSummary }}</div>
          <div
            v-if="testResult.probe"
            class="mt-1.5 flex items-center gap-1.5 break-words [&_svg]:size-3 [&_svg]:flex-none"
            :class="testResult.probe.ok ? 'text-success' : 'text-destructive'"
          >
            <Icon :name="testResult.probe.ok ? 'check' : 'alert'" />
            <span>{{ probeSummary }}</span>
          </div>
          <!-- stderr thô của tiến trình ⇒ mono. -->
          <pre
            v-if="testResult.stderr?.length"
            class="mt-2 max-h-32 overflow-y-auto rounded-md bg-sidebar px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
            >{{ testResult.stderr.join('\n') }}</pre
          >
        </div>
      </Alert>
    </div>

    <!-- section tabs (fit the pane without scrolling the whole page): hugs content,
         sits between the header card + the scroll body, aligned to the same gutter. -->
    <Tabs v-model="activeTab" class="mx-3.5 mt-3 max-w-[calc(100%-1.75rem)] flex-none self-start">
      <TabsList class="max-w-full justify-start overflow-x-auto">
        <TabsTrigger v-for="tab in tabs" :key="tab" :value="tab">
          {{ t('connections.section.' + tab) }}
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- The scroll body owns the vertical space left after hero + tabs; only its content
         scrolls, so the page itself never does. -->
    <div class="flex-1 overflow-y-auto p-3.5">
      <!-- ── General (description + settings card + connection card) ──────── -->
      <template v-if="activeTab === 'general'">
        <p v-if="source.description" class="mb-3.5 text-base leading-relaxed text-muted-foreground">
          {{ source.description }}
        </p>

        <!-- Settings card: enabled + trust as tidy rows -->
        <Card class="gap-0 overflow-hidden rounded-lg py-0 shadow-none">
          <div class="flex items-center justify-between gap-3.5 px-3.5 py-3">
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="text-base font-medium text-foreground">
                {{ t('connections.detail.enabled') }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('connections.detail.enabledHint') }}
              </span>
            </div>
            <Switch
              :checked="source.enabled"
              :title="t('connections.enableToggle')"
              :aria-label="t('connections.enableToggle')"
              @update:checked="emit('toggle')"
            />
          </div>
          <Separator />
          <div class="flex items-center justify-between gap-3.5 px-3.5 py-3">
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="text-base font-medium text-foreground">
                {{ t('connections.detail.trust') }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('connections.detail.trustHint') }}
              </span>
            </div>
            <Badge variant="outline" class="capitalize">{{ source.trust }}</Badge>
          </div>
        </Card>

        <!-- Connection card: config detail as a clean key/value list -->
        <Card class="mt-3 gap-0 overflow-hidden rounded-lg py-0 shadow-none">
          <div
            class="flex items-center gap-2 border-b px-3.5 py-2.5 text-xs text-muted-foreground [&_svg]:size-3.5"
          >
            <Icon name="conn" />
            {{ t('connections.section.connection') }}
          </div>
          <div class="flex flex-col divide-y">
            <div class="flex gap-3.5 px-3.5 py-2.5 text-sm">
              <span class="min-w-26 flex-none text-muted-foreground">
                {{ t('connections.info.type') }}
              </span>
              <span class="min-w-0 flex-1 break-words text-foreground">
                {{ source.type.toUpperCase() }}
              </span>
            </div>
            <div v-if="sourceUrl" class="flex gap-3.5 px-3.5 py-2.5 text-sm">
              <span class="min-w-26 flex-none text-muted-foreground">
                {{ t('connections.info.' + urlLabel) }}
              </span>
              <span class="min-w-0 flex-1 font-mono break-words text-foreground">
                {{ sourceUrl }}
              </span>
            </div>
            <div
              v-for="row in configRows"
              :key="row.key"
              class="flex gap-3.5 px-3.5 py-2.5 text-sm"
            >
              <!-- Khoá config là identifier ⇒ mono. -->
              <span class="min-w-26 flex-none font-mono text-muted-foreground">{{ row.key }}</span>
              <span
                class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 break-words text-foreground"
                :class="row.mono && 'font-mono'"
              >
                <span>{{ row.value }}</span>
                <!-- Keychain reference badge — accent-tinted pill naming the stored key. -->
                <Badge
                  v-if="row.secretKey"
                  variant="outline"
                  class="rounded-sm border-selected-border px-2 py-0 text-sm font-normal text-primary [&_svg]:size-2.5"
                >
                  <Icon name="shield" />
                  {{ row.secretKey }}
                </Badge>
              </span>
            </div>
            <div class="flex gap-3.5 px-3.5 py-2.5 text-sm">
              <span class="min-w-26 flex-none text-muted-foreground">
                {{ t('connections.info.lastTested') }}
              </span>
              <span class="min-w-0 flex-1 text-foreground">{{ lastTestedRelative }}</span>
            </div>
          </div>
          <div
            v-if="connectionError"
            class="flex gap-2 border-t border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
          >
            <Icon name="alert" class="mt-0.5 size-3.5 flex-none" />
            <!-- URLs inside a provider error (e.g. Slack's "enable it here:
                 https://api.slack.com/apps/…/app-assistant") become real links
                 opening in the system browser — the raw JSON string was
                 unreadable and unclickable. -->
            <span class="font-mono break-words">
              <template v-for="(part, i) in errorParts" :key="i">
                <a
                  v-if="part.isUrl"
                  :href="part.text"
                  class="cursor-pointer text-primary underline underline-offset-2 hover:opacity-85"
                  @click.prevent="openErrorLink(part.text)"
                >
                  {{ part.text }}
                </a>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
          </div>
        </Card>
      </template>

      <!-- ── Tools (mcp + api) ──────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'tools'">
        <!-- Loading: header + live activity console (what the handshake is doing). -->
        <template v-if="toolsLoading">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              class="size-3 flex-none animate-spin rounded-full border-2 border-border border-t-primary"
            />
            {{ t('connections.tools.loading') }}
          </div>
          <ConnectionToolsLog v-if="toolsLog.length" class="mt-2" :lines="toolsLog" live />
        </template>

        <!-- Error: banner + the full transcript (it explains the failure). -->
        <template v-else-if="toolsError">
          <Alert variant="destructive" class="mt-3.5 border-destructive/40 px-3 py-2.5">
            <Icon name="alert" />
            <div class="col-start-2 min-w-0">
              <div class="mb-0.5 font-semibold">{{ t('connections.tools.errorTitle') }}</div>
              <div class="font-mono break-words">
                <template v-for="(part, i) in toolsErrorParts" :key="i">
                  <a
                    v-if="part.isUrl"
                    :href="part.text"
                    class="cursor-pointer text-primary underline underline-offset-2 hover:opacity-85"
                    @click.prevent="openErrorLink(part.text)"
                  >
                    {{ part.text }}
                  </a>
                  <template v-else>{{ part.text }}</template>
                </template>
              </div>
            </div>
          </Alert>
          <ConnectionToolsLog v-if="toolsLog.length" class="mt-2" :lines="toolsLog" />
        </template>

        <!-- No tools: empty note + collapsible transcript. -->
        <template v-else-if="!tools.length">
          <div class="text-sm text-muted-foreground">{{ t('connections.tools.empty') }}</div>
          <div v-if="toolsLog.length" class="mt-2">
            <Button
              variant="ghost"
              size="xs"
              class="-ml-1.5 gap-1.5 px-1.5 font-normal text-muted-foreground [&_svg]:size-3"
              @click="logOpen = !logOpen"
            >
              <Icon name="chev" class="transition-transform" :class="!logOpen && '-rotate-90'" />
              {{ t(logOpen ? 'connections.tools.hideLog' : 'connections.tools.showLog') }}
            </Button>
            <ConnectionToolsLog v-if="logOpen" class="mt-2" :lines="toolsLog" />
          </div>
        </template>

        <!-- Tools listed: the list + a collapsible transcript beneath. -->
        <template v-else>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="tool in tools"
              :key="tool.name"
              class="flex items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-muted-foreground"
              :class="!tool.allowed && 'opacity-70'"
            >
              <Icon name="zap" class="mt-0.5 size-3 flex-none" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <!-- Tên tool là identifier ⇒ mono. -->
                  <span class="font-mono text-sm font-medium text-foreground">
                    {{ tool.display }}
                  </span>
                  <Badge
                    variant="outline"
                    class="uppercase"
                    :class="
                      tool.allowed
                        ? 'border-success text-success'
                        : 'border-destructive/40 text-destructive'
                    "
                  >
                    {{
                      t(tool.allowed ? 'connections.tools.allowed' : 'connections.tools.blocked')
                    }}
                  </Badge>
                </div>
                <div v-if="tool.description" class="mt-0.5 text-sm text-muted-foreground">
                  {{ tool.description }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="toolsLog.length" class="mt-2">
            <Button
              variant="ghost"
              size="xs"
              class="-ml-1.5 gap-1.5 px-1.5 font-normal text-muted-foreground [&_svg]:size-3"
              @click="logOpen = !logOpen"
            >
              <Icon name="chev" class="transition-transform" :class="!logOpen && '-rotate-90'" />
              {{ t(logOpen ? 'connections.tools.hideLog' : 'connections.tools.showLog') }}
            </Button>
            <ConnectionToolsLog v-if="logOpen" class="mt-2" :lines="toolsLog" />
          </div>
        </template>
      </template>

      <!-- ── Permissions ────────────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'permissions'">
        <!-- Right-aligned edit affordance (the tab label already names the section, so
             no redundant header text). Documentation folds its Edit into the markdown
             toolbar row instead. -->
        <div v-if="!permsEditing" class="mb-2 flex justify-end">
          <Button
            variant="outline"
            size="iconSm"
            class="size-6 [&_svg]:size-3"
            :title="t('connections.perms.edit')"
            :aria-label="t('connections.perms.edit')"
            @click="startPermsEdit"
          >
            <Icon name="edit" />
          </Button>
        </div>

        <!-- permissions: edit (structured, line-based). Pattern/path là code ⇒ mono. -->
        <div v-if="permsEditing" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <Label for="cnd-perm-mcp" class="text-xs font-normal text-muted-foreground">
              {{ t('connections.perms.mcp') }}
            </Label>
            <Textarea
              id="cnd-perm-mcp"
              v-model="permsMcpText"
              class="min-h-18 resize-y font-mono text-sm"
              spellcheck="false"
              :placeholder="t('connections.perms.mcpPh')"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="cnd-perm-api" class="text-xs font-normal text-muted-foreground">
              {{ t('connections.perms.api') }}
            </Label>
            <Textarea
              id="cnd-perm-api"
              v-model="permsApiText"
              class="min-h-18 resize-y font-mono text-sm"
              spellcheck="false"
              :placeholder="t('connections.perms.apiPh')"
            />
            <div class="text-xs text-faint">{{ t('connections.perms.apiHint') }}</div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="cnd-perm-bash" class="text-xs font-normal text-muted-foreground">
              {{ t('connections.perms.bash') }}
            </Label>
            <Textarea
              id="cnd-perm-bash"
              v-model="permsBashText"
              class="min-h-18 resize-y font-mono text-sm"
              spellcheck="false"
              :placeholder="t('connections.perms.bashPh')"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="cnd-perm-write" class="text-xs font-normal text-muted-foreground">
              {{ t('connections.perms.write') }}
            </Label>
            <Textarea
              id="cnd-perm-write"
              v-model="permsWriteText"
              class="min-h-18 resize-y font-mono text-sm"
              spellcheck="false"
              :placeholder="t('connections.perms.writePh')"
            />
          </div>
          <div class="text-xs text-faint">{{ t('connections.perms.editHint') }}</div>
          <Alert
            v-if="permsError"
            variant="destructive"
            class="mt-3.5 border-destructive/40 px-3 py-2.5"
          >
            <Icon name="alert" />
            <div class="col-start-2 min-w-0">
              <div class="mb-0.5 font-semibold">{{ t('connections.perms.saveError') }}</div>
              <div class="font-mono break-words">{{ permsError }}</div>
            </div>
          </Alert>
          <div class="flex justify-end gap-2">
            <Button :disabled="permsSaving" variant="outline" size="sm" @click="cancelPermsEdit">
              {{ t('common.cancel') }}
            </Button>
            <Button
              :disabled="permsSaving"
              variant="default"
              size="sm"
              class="[&_svg]:size-3"
              @click="savePermsEdit"
            >
              <Icon
                :name="permsSaving ? 'refresh' : 'check'"
                :class="permsSaving && 'animate-spin'"
              />
              {{ permsSaving ? t('connections.edit.saving') : t('common.save') }}
            </Button>
          </div>
        </div>

        <!-- permissions: view -->
        <template v-else>
          <div v-if="permsLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              class="size-3 flex-none animate-spin rounded-full border-2 border-border border-t-primary"
            />
            {{ t('connections.perms.loading') }}
          </div>
          <div v-else-if="!hasPermissions" class="text-sm text-muted-foreground">
            {{ t('connections.perms.empty') }}
          </div>
          <div v-else class="flex flex-col gap-3">
            <div v-if="permissions?.allowedMcpPatterns?.length" class="flex flex-col gap-1">
              <div class="text-xs text-muted-foreground">{{ t('connections.perms.mcp') }}</div>
              <div
                v-for="p in permissions.allowedMcpPatterns"
                :key="p"
                class="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-sm break-all text-muted-foreground"
              >
                {{ p }}
              </div>
            </div>
            <div v-if="apiEndpointLines.length" class="flex flex-col gap-1">
              <div class="text-xs text-muted-foreground">{{ t('connections.perms.api') }}</div>
              <div
                v-for="p in apiEndpointLines"
                :key="p"
                class="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-sm break-all text-muted-foreground"
              >
                {{ p }}
              </div>
            </div>
            <div v-if="permissions?.allowedBashPatterns?.length" class="flex flex-col gap-1">
              <div class="text-xs text-muted-foreground">{{ t('connections.perms.bash') }}</div>
              <div
                v-for="p in permissions.allowedBashPatterns"
                :key="p"
                class="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-sm break-all text-muted-foreground"
              >
                {{ p }}
              </div>
            </div>
            <div v-if="permissions?.allowedWritePaths?.length" class="flex flex-col gap-1">
              <div class="text-xs text-muted-foreground">{{ t('connections.perms.write') }}</div>
              <div
                v-for="p in permissions.allowedWritePaths"
                :key="p"
                class="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-sm break-all text-muted-foreground"
              >
                {{ p }}
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- ── Documentation ──────────────────────────────────────────────── -->
      <template v-else-if="activeTab === 'documentation'">
        <!-- documentation: edit (direct markdown textarea — no AI). The Edit
             trigger lives in the markdown toolbar row below (allow-edit), so view
             mode shows a single controls row (Render/Raw · Copy · Edit). -->
        <div v-if="guideEditing" class="flex flex-col gap-3">
          <Textarea
            v-model="guideDraft"
            class="min-h-72 resize-y font-mono text-sm"
            spellcheck="false"
            :placeholder="t('connections.doc.editPlaceholder')"
          />
          <div class="text-xs text-faint">{{ t('connections.doc.editHint') }}</div>
          <Alert
            v-if="guideError"
            variant="destructive"
            class="mt-3.5 border-destructive/40 px-3 py-2.5"
          >
            <Icon name="alert" />
            <div class="col-start-2 min-w-0">
              <div class="mb-0.5 font-semibold">{{ t('connections.doc.saveError') }}</div>
              <div class="font-mono break-words">{{ guideError }}</div>
            </div>
          </Alert>
          <div class="flex justify-end gap-2">
            <Button :disabled="guideSaving" variant="outline" size="sm" @click="cancelGuideEdit">
              {{ t('common.cancel') }}
            </Button>
            <Button
              :disabled="guideSaving"
              variant="default"
              size="sm"
              class="[&_svg]:size-3"
              @click="saveGuideEdit"
            >
              <Icon
                :name="guideSaving ? 'refresh' : 'check'"
                :class="guideSaving && 'animate-spin'"
              />
              {{ guideSaving ? t('connections.edit.saving') : t('common.save') }}
            </Button>
          </div>
        </div>

        <!-- documentation: view -->
        <div v-else-if="guideLoading" class="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            class="size-3 flex-none animate-spin rounded-full border-2 border-border border-t-primary"
          />
          {{ t('connections.doc.loading') }}
        </div>
        <!-- hook-ok: `.lmb-head` / `.lmb-title` là class gốc của LibraryMarkdownBody — viewer
             dùng lại nằm đầu tab nên bỏ margin trên + giấu tiêu đề rỗng của nó. -->
        <LibraryMarkdownBody
          v-else
          class="[&_.lmb-head]:mt-0 [&_.lmb-title]:hidden"
          :title="''"
          :content="guide"
          :empty-text="t('connections.doc.empty')"
          allow-edit
          :edit-label="t('connections.doc.edit')"
          :edit-title="t('connections.doc.edit')"
          @edit-body="startGuideEdit"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Source detail pane (ADR 0060 P1 + P5) — Craft-style sections
// (Connection / Tools / Permissions / Documentation). There is no live process:
// the status pill reflects the PERSISTED derived status. The Test button runs
// `source.test` (persist + auto-enable) and surfaces a transient banner; the
// three read-only sections lazy-fetch on open via useConnectionDetail. Test/OAuth
// stay here (they emit to the page-controller); section reads go through the store.
import { computed, ref, watch } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import ConnectionToolsLog from '~/components/connection/ConnectionToolsLog.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import SourceStatusDot from '~/components/connection/SourceStatusDot.vue'
import { useConnectionDetail } from '~/composables/useConnectionDetail'
import { useSidecar } from '~/composables/useSidecar'
import type { Source, SourceOAuthResult, SourceTestOutcome } from '~/stores/connections'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  source: Source
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  reveal: []
  toggle: []
  test: [done: (outcome: SourceTestOutcome) => void]
  oauth: [done: (result: SourceOAuthResult) => void]
  'cancel-oauth': []
}>()

const { t } = useI18n()

// "Show in folder" only works inside the Electron shell (main derives the path).
// In browser dev the bridge is absent, so hide the affordance rather than fail.
const canReveal = useSidecar().available
const sc = useSidecar()

// Derived display + the three read-only sections (Connection/Tools/Permissions/Doc).
const {
  status,
  transport,
  sourceUrl,
  urlLabel,
  lastTestedRelative,
  connectionError,
  configRows,
  showTools,
  toolsLoading,
  toolsError,
  tools,
  toolsLog,
  permsLoading,
  permissions,
  hasPermissions,
  apiEndpointLines,
  permsEditing,
  permsSaving,
  permsError,
  permsMcpText,
  permsApiText,
  permsBashText,
  permsWriteText,
  startPermsEdit,
  cancelPermsEdit,
  savePermsEdit,
  guideLoading,
  guide,
  guideEditing,
  guideDraft,
  guideSaving,
  guideError,
  startGuideEdit,
  cancelGuideEdit,
  saveGuideEdit,
} = useConnectionDetail(() => props.source)

// The detail is tabbed (fits the pane without scrolling the whole page): General
// (description + controls + connection info), Tools, Permissions, Documentation.
// The Tools tab only exists for kinds that expose tools (mcp/api — `showTools`).
type CndTab = 'general' | 'tools' | 'permissions' | 'documentation'
const activeTab = ref<CndTab>('general')
const tabs = computed<CndTab[]>(() => [
  'general',
  ...(showTools.value ? (['tools'] as CndTab[]) : []),
  'permissions',
  'documentation',
])

// Provider error strings sometimes carry URLs the user must follow (Slack's
// "enable MCP access" app-assistant link, OAuth consoles…). Split a message
// into text/url parts so the template can render real anchors; clicks go
// through sc.openExternal so they land in the system browser, never the
// agent's embedded jar.
const URL_RE = /https?:\/\/[^\s"'<>\\)]+/g
// MCP servers return the raw HTTP body, which is a JSON-RPC envelope whose
// inner message is *escaped* ("https:\/\/api.slack.com\/…" — backslashes in the
// URL, quotes escaped too). A URL regex can't match that, so the earlier pass
// rendered zero anchors. Parse the envelope first — error.message is already
// unescaped by JSON.parse — and fall back to unescaping the raw text when it
// isn't JSON.
const humanizeError = (msg: string): string => {
  const brace = msg.indexOf('{')
  if (brace !== -1) {
    try {
      const parsed: unknown = JSON.parse(msg.slice(brace))
      const err = (parsed as { error?: { message?: unknown; code?: unknown } })?.error
      if (typeof err?.message === 'string') {
        const head = msg.slice(0, brace).trim()
        const code = err.code != null ? ` (code ${String(err.code)})` : ''
        return `${head ? head + ' ' : ''}${err.message}${code}`
      }
    } catch {
      /* not JSON — fall through to unescape */
    }
  }
  return msg.replace(/\\(["/\\])/g, '$1')
}
const splitErrorLinks = (msg: string | null | undefined) => {
  const text = humanizeError(msg ?? '')
  if (!text) return []
  const parts: { text: string; isUrl: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0
    // Trim trailing punctuation that was never part of the URL (JSON `"`, `)`, `.`).
    const url = m[0].replace(/[.,;:!?'")\]}]+$/, '')
    if (idx > last) parts.push({ text: text.slice(last, idx), isUrl: false })
    parts.push({ text: url, isUrl: true })
    last = idx + url.length
    // If the regex grabbed more than the trimmed url, re-append the tail as text.
    if (m[0].length > url.length) parts.push({ text: m[0].slice(url.length), isUrl: false })
  }
  if (last < text.length) parts.push({ text: text.slice(last), isUrl: false })
  return parts
}
const errorParts = computed(() => splitErrorLinks(connectionError.value))
const toolsErrorParts = computed(() => splitErrorLinks(toolsError.value))
const openErrorLink = (url: string) => {
  void sc.openExternal(url).catch((err) => console.warn('[connection] openExternal failed', err))
}

// After a successful/empty run the activity transcript collapses behind a toggle
// (it stays expanded while loading and on error, where it's the primary content).
const logOpen = ref(false)

// --- test (transient banner) ----------------------------------------------
const testing = ref(false)
const testResult = ref<SourceTestOutcome | null>(null)
const testSummary = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (r.ok) {
    const tc = r.tools?.length ?? 0
    const rc = r.resources?.length ?? 0
    return t('connections.detail.testSummary', { tools: tc, resources: rc })
  }
  return r.error ?? t('connections.detail.testUnknown')
})

// Banner is "good" only when the handshake succeeded AND (no probe OR it passed).
const bannerOk = computed(() => {
  const r = testResult.value
  if (!r) return false
  return r.ok && (!r.probe || r.probe.ok)
})
const bannerTitle = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (!r.ok) return t('connections.detail.testFail')
  if (r.probe && !r.probe.ok) return t('connections.detail.authFail')
  return t('connections.detail.testOk')
})
const probeSummary = computed(() => {
  const p = testResult.value?.probe
  if (!p) return ''
  return p.ok
    ? t('connections.detail.authOk', { tool: p.tool })
    : t('connections.detail.authFailSum', { tool: p.tool, error: p.error ?? '' })
})
const onTest = () => {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  emit('test', (outcome: SourceTestOutcome) => {
    testResult.value = outcome
    testing.value = false
  })
}

// --- OAuth (ADR 0060 P2 mcp · P6 api) ---------------------------------------
// The Connect flow is shared: `source.startOAuth {slug}` now authorizes both a
// remote MCP source (mcp.authType 'oauth') and a REST API source (api.authType
// 'oauth', endpoints from an explicit api.oauth block or auto-discovered).
const isOAuthSource = computed(() => {
  const s = props.source
  if (s.type === 'mcp') return s.mcp.authType === 'oauth'
  if (s.type === 'api') return s.api.authType === 'oauth'
  return false
})
const oauthPending = ref(false)
const oauthTitle = computed(() =>
  status.value === 'connected'
    ? t('connections.detail.oauthReconnect')
    : t('connections.detail.oauthConnect'),
)
const onConnectOAuth = () => {
  if (oauthPending.value) return
  oauthPending.value = true
  emit('oauth', () => {
    oauthPending.value = false
  })
}
const onCancelOAuth = () => {
  emit('cancel-oauth')
}

// The detail pane is a single reused instance, so transient per-source state must
// reset when the shown source changes (the sections reset inside the composable).
watch(
  () => props.source.slug,
  () => {
    testResult.value = null
    testing.value = false
    oauthPending.value = false
    logOpen.value = false
    activeTab.value = 'general'
  },
)
</script>
