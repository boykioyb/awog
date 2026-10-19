<template>
  <div :class="CAP_TAB">
    <div v-if="!entry.initiator" :class="CAP_NOTE">{{ t('capture.initiator.none') }}</div>
    <template v-else>
      <section :class="CAP_SEC">
        <Table :class="CAP_KV">
          <TableBody>
            <TableRow>
              <TableHead>{{ t('capture.initiator.type') }}</TableHead>
              <TableCell>
                <Badge variant="outline">{{ entry.initiator.type }}</Badge>
              </TableCell>
            </TableRow>
            <TableRow v-if="entry.initiator.url">
              <TableHead>{{ t('capture.initiator.url') }}</TableHead>
              <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">
                {{ entry.initiator.url }}
                <template v-if="entry.initiator.lineNumber !== undefined">
                  :{{ entry.initiator.lineNumber }}
                </template>
              </TableCell>
            </TableRow>
            <TableRow v-if="entry.documentUrl">
              <TableHead>{{ t('capture.initiator.document') }}</TableHead>
              <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">
                {{ entry.documentUrl }}
              </TableCell>
            </TableRow>
            <TableRow v-if="entry.frameId">
              <TableHead>{{ t('capture.initiator.frame') }}</TableHead>
              <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">
                {{ entry.frameId }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
      <section v-if="entry.initiator.stack?.length" :class="CAP_SEC">
        <h4 :class="CAP_SEC_TITLE">
          {{ t('capture.initiator.stack') }}
          <Button
            variant="ghost"
            size="iconSm"
            :class="copiedKey === 'stack' && 'text-success'"
            :title="labelFor('stack', t('capture.headers.copy'))"
            :aria-label="labelFor('stack', t('capture.headers.copy'))"
            @click="copy('stack', entry.initiator.stack.join('\n'))"
          >
            <Icon :name="iconFor('stack')" />
          </Button>
        </h4>
        <pre :class="CAP_PRE">{{ entry.initiator.stack.join('\n') }}</pre>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CaptureEntry } from '~/types/network-capture'
import { CAP_KV, CAP_NOTE, CAP_PRE, CAP_SEC, CAP_SEC_TITLE, CAP_TAB } from './capture-ui'

defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()
</script>
