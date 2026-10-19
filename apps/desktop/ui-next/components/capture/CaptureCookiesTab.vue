<template>
  <div :class="CAP_TAB">
    <section :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">{{ t('capture.cookies.sent', { n: sent.length }) }}</h4>
      <Table v-if="sent.length" :class="CAP_KV">
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('capture.cookies.name') }}</TableHead>
            <TableHead>{{ t('capture.cookies.value') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(c, i) in sent" :key="i">
            <TableHead class="font-mono">{{ c.name }}</TableHead>
            <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">{{ c.value }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div v-else :class="CAP_NOTE">{{ t('capture.cookies.noneSent') }}</div>
    </section>

    <section :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">{{ t('capture.cookies.received', { n: received.length }) }}</h4>
      <div v-if="received.length" class="overflow-x-auto">
        <Table class="[&_td]:min-w-[8ch] [&_td]:pr-3 [&_th]:pr-3" :class="CAP_KV">
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('capture.cookies.name') }}</TableHead>
              <TableHead>{{ t('capture.cookies.value') }}</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Expires / Max-Age</TableHead>
              <TableHead>HttpOnly</TableHead>
              <TableHead>Secure</TableHead>
              <TableHead>SameSite</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(c, i) in received" :key="i">
              <TableHead class="font-mono">{{ c.name }}</TableHead>
              <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">
                {{ c.value }}
              </TableCell>
              <TableCell class="font-mono">{{ c.domain }}</TableCell>
              <TableCell class="font-mono">{{ c.path }}</TableCell>
              <TableCell>{{ c.expires }}</TableCell>
              <TableCell>
                <Badge :variant="c.httpOnly ? 'success' : 'destructive'">
                  {{ c.httpOnly ? '✓' : t('capture.cookies.missing') }}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge :variant="c.secure ? 'success' : 'destructive'">
                  {{ c.secure ? '✓' : t('capture.cookies.missing') }}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge :variant="sameSiteVariant(c)">
                  {{ c.sameSite || t('capture.cookies.missing') }}
                </Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div v-else :class="CAP_NOTE">{{ t('capture.cookies.noneReceived') }}</div>
    </section>

    <section v-if="entry.blockedCookies?.length" :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">
        {{ t('capture.cookies.blocked', { n: entry.blockedCookies.length }) }}
      </h4>
      <Table :class="CAP_KV">
        <TableBody>
          <TableRow v-for="(b, i) in entry.blockedCookies" :key="i">
            <TableHead class="font-mono">{{ b.name || '—' }}</TableHead>
            <TableCell class="whitespace-pre-wrap wrap-anywhere">
              <Badge v-for="r in b.reasons" :key="r" variant="destructive" class="mr-1">
                {{ r }}
              </Badge>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import { parseCookieHeader, parseSetCookie } from '~/utils/capture-export'
import { CAP_KV, CAP_NOTE, CAP_SEC, CAP_SEC_TITLE, CAP_TAB } from './capture-ui'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

type ReceivedCookie = { sameSite: string; sameSiteNone: boolean; secure: boolean }

// Thiếu SameSite = cảnh báo (trình duyệt mặc định Lax); SameSite=None mà không Secure = bị từ chối.
const sameSiteVariant = (c: ReceivedCookie): 'success' | 'warning' | 'destructive' =>
  !c.sameSite ? 'warning' : c.sameSiteNone && !c.secure ? 'destructive' : 'success'

const sent = computed(() =>
  props.entry.requestHeaders
    .filter(([k]) => k.toLowerCase() === 'cookie')
    .flatMap(([, v]) => parseCookieHeader(v)),
)

const received = computed(() =>
  props.entry.responseHeaders
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const c = parseSetCookie(v)
      const attrs: Record<string, string | true> = {}
      for (const [k, val] of Object.entries(c.attrs)) attrs[k.toLowerCase()] = val
      const str = (k: string): string => {
        const val = attrs[k]
        return typeof val === 'string' ? val : ''
      }
      const sameSite = str('samesite')
      return {
        name: c.name,
        value: c.value,
        domain: str('domain'),
        path: str('path'),
        expires: str('expires') || (str('max-age') ? `max-age=${str('max-age')}` : ''),
        httpOnly: attrs.httponly !== undefined,
        secure: attrs.secure !== undefined,
        sameSite,
        sameSiteNone: sameSite.toLowerCase() === 'none',
      }
    }),
)
</script>
