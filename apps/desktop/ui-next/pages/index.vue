<template>
  <section class="page on" data-page="home">
    <div class="scroll">
      <div class="bento">
        <div class="tile c8">
          <div class="th">
            <Icon name="clock" />
            <span class="tt">{{ t('home.attention.title') }}</span>
            <span class="ct">{{ t('home.attention.count', { n: 2 }) }}</span>
          </div>
          <div class="await">
            <div class="acard hot">
              <span class="aic"><Icon name="alert" /></span>
              <div class="bd">
                <div class="t1">Migrate session store sang MCP pool</div>
                <div class="t2">
                  <b>developer</b>
                  hỏi: "worktree isolation hay shared lock?" · Opus 4.8
                </div>
              </div>
              <span class="act" @click="navigateTo('/sessions')">{{ t('home.reply') }}</span>
            </div>
            <div class="acard hot">
              <span class="aic"><Icon name="shield" /></span>
              <div class="bd">
                <div class="t1">Refactor SessionComposer.vue</div>
                <div class="t2">
                  Permission: cho phép
                  <b>writeFile</b>
                  apps/desktop/ui/components/session/…
                </div>
              </div>
              <span class="act" @click="navigateTo('/sessions')">{{ t('home.review') }}</span>
            </div>
          </div>
        </div>

        <div class="tile c4 stat">
          <div class="lbl">{{ t('home.running.label') }}</div>
          <div class="big" style="color: var(--accent)">3</div>
          <div class="sub">2 task · 1 session · ~14k tok/min</div>
        </div>

        <div class="tile c7">
          <div class="th">
            <Icon name="play" />
            <span class="tt">{{ t('home.running.title') }}</span>
            <span class="ct">
              <a @click="navigateTo('/tasks')">{{ t('home.openTasks') }}</a>
            </span>
          </div>
          <div class="run">
            <div class="ritem">
              <div class="rh">
                <span class="pulse" />
                <span class="nm">Lazy-load transcripts (ADR 0048)</span>
                <span class="who">tech-lead · Opus 4.8</span>
              </div>
              <div class="ph">
                Node
                <b>3/5</b>
                · "Write ADR + IPC contract"
              </div>
              <div class="bar"><i style="width: 62%" /></div>
              <div class="mt">
                <span>elapsed 4m 12s</span>
                <span>62%</span>
              </div>
            </div>
            <div class="ritem">
              <div class="rh">
                <span class="pulse" />
                <span class="nm">Audit fs.* path sanitize</span>
                <span class="who">infosec · Sonnet 4.6</span>
              </div>
              <div class="ph">
                Node
                <b>1/3</b>
                · "Scan workspace I/O sinks"
              </div>
              <div class="bar"><i style="width: 28%" /></div>
              <div class="mt">
                <span>elapsed 1m 03s</span>
                <span>28%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="tile c5">
          <div class="th">
            <Icon name="act" />
            <span class="tt">{{ t('home.activity.title') }}</span>
            <span class="ct">{{ t('home.activity.unit') }}</span>
          </div>
          <div class="spark">
            <i style="height: 22%" />
            <i style="height: 38%" />
            <i style="height: 18%" />
            <i style="height: 46%" />
            <i style="height: 60%" />
            <i style="height: 34%" />
            <i style="height: 72%" />
            <i class="hi" style="height: 88%" />
            <i style="height: 50%" />
            <i style="height: 64%" />
            <i class="hi" style="height: 95%" />
            <i style="height: 40%" />
          </div>
          <div class="usage">
            <span class="u1">
              2.4M
              <span style="font-size: 0.8462rem; color: var(--textDim); font-weight: 400">
                {{ t('home.activity.today') }}
              </span>
            </span>
            <span class="u2">↑ 18% vs hôm qua</span>
          </div>
        </div>

        <div class="tile c4">
          <div class="th">
            <Icon name="git" />
            <span class="tt">Git</span>
            <span class="ct">
              <a @click="navigateTo('/git')">{{ t('home.open') }}</a>
            </span>
          </div>
          <div class="grow">
            <div>
              <div class="rn">awog</div>
              <div class="br">fix/session-mcp-pool</div>
            </div>
            <div style="margin-left: auto; display: flex; gap: 6px">
              <span class="gchip m">7 M</span>
              <span class="gchip a">↑2</span>
            </div>
          </div>
          <div class="grow">
            <div>
              <div class="rn">sidecar</div>
              <div class="br">main</div>
            </div>
            <span class="gchip" style="margin-left: auto">{{ t('home.git.clean') }}</span>
          </div>
        </div>

        <div class="tile c4">
          <div class="th">
            <Icon name="agents" />
            <span class="tt">Agents</span>
            <span class="ct">{{ t('home.agents.active', { n: 8 }) }}</span>
          </div>
          <div class="ag">
            <span class="ab" style="background: rgba(96, 165, 250, 0.15); color: #93c5fd">TL</span>
            <div>
              <div class="an">tech-lead</div>
              <div class="am">Opus 4.8</div>
            </div>
            <span class="as live">{{ t('home.agents.working') }}</span>
          </div>
          <div class="ag">
            <span class="ab" style="background: rgba(239, 68, 68, 0.13); color: #fca5a5">IS</span>
            <div>
              <div class="an">infosec</div>
              <div class="am">Sonnet 4.6</div>
            </div>
            <span class="as live">{{ t('home.agents.working') }}</span>
          </div>
          <div class="ag">
            <span class="ab" style="background: rgba(167, 139, 250, 0.15); color: #c4b5fd">DV</span>
            <div>
              <div class="an">developer</div>
              <div class="am">Opus 4.8</div>
            </div>
            <span class="as">2m ago</span>
          </div>
        </div>

        <div class="tile c4">
          <div class="th">
            <Icon name="conn" />
            <span class="tt">Connections</span>
            <span class="ct">{{ t('home.connections.count', { n: 5 }) }}</span>
          </div>
          <div class="conn">
            <div class="cn">
              <span class="cdot" style="background: var(--green)" />
              github
              <span class="cm">running</span>
            </div>
            <div class="cn">
              <span class="cdot" style="background: var(--green)" />
              filesystem
              <span class="cm">running</span>
            </div>
            <div class="cn">
              <span class="cdot" style="background: var(--textFaint)" />
              linear
              <span class="cm">idle 8m</span>
            </div>
            <div class="cn">
              <span class="cdot" style="background: var(--textFaint)" />
              notion
              <span class="cm">idle</span>
            </div>
          </div>
        </div>

        <div class="tile c12">
          <div class="th">
            <Icon name="sessions" />
            <span class="tt">{{ t('home.recent.title') }}</span>
            <span class="ct">
              <a @click="navigateTo('/sessions')">{{ t('home.all') }}</a>
            </span>
          </div>
          <div class="rs">
            <span class="si" style="background: var(--amber)" />
            <span class="st1">Sửa SessionComposer — gộp model/token control</span>
            <span class="tag">awog</span>
            <span class="tag">Opus 4.8</span>
            <span class="sw">đang chờ · 3m</span>
          </div>
          <div class="rs">
            <span class="si" style="background: var(--accent)" />
            <span class="st1">Byte-minimal JSONL persist + stream loader</span>
            <span class="tag">awog</span>
            <span class="tag">Opus 4.8</span>
            <span class="sw">đang chạy · 12m</span>
          </div>
          <div class="rs">
            <span class="si" style="background: var(--textFaint)" />
            <span class="st1">Reuse one MCP server child per session</span>
            <span class="tag">awog</span>
            <span class="tag">Sonnet 4.6</span>
            <span class="sw">xong · 2h</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Home — bento dashboard ported from awog-prototype.html (data-page="home").
// Chrome strings go through i18n (t); mock entity content (session/agent names,
// counts) stays literal until wired to live stores. navigateTo + useI18n are
// Nuxt auto-imports.
const { t } = useI18n()
</script>
