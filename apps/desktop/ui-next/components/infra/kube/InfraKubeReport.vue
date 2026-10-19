<template>
  <!-- Mục thứ ba của vùng bảng: **Báo cáo**. Cùng cụm với hai bảng kia, nhưng nhìn
       theo chỉ số thay vì từng hàng — "cụm này có ổn không, chỗ nào lệch, vì sao,
       có đang tệ đi không".

       Vì sao nằm TRONG tab Kubernetes chứ không phải màn Tổng quan: mọi con số ở
       đây là chuyện của MỘT cluster/namespace đang ghim. Màn Tổng quan nói về tài
       khoản AWS (chi phí, log, danh tính) — trộn hai thứ đó vào nhau là để người
       dùng đọc một chỗ rồi tưởng nó nói về chỗ khác.

       BỐ CỤC ĐI THEO CÂU HỎI, KHÔNG THEO NGUỒN DỮ LIỆU (sửa 2026-09-17). Bản đầu
       xếp tất cả thành một hàng ô số + một thanh trạng thái, nên một cụm khoẻ hiện
       ra là bốn ô toàn số đẹp còn một cụm hỏng cũng hiện ra… bốn ô, chỉ khác con số:
       không có thứ tự đọc, không nói vì sao, và thiếu hẳn CPU/RAM/node/event — tức
       thiếu đúng phần trả lời "vì sao". Nay đọc từ trên xuống là:
         1. Điểm + MỘT câu "có ai đang không dùng được không" + tên vài việc nặng nhất.
         2. Đang ảnh hưởng người dùng — từng việc, kèm nút mở log/describe/terminal
            của đúng pod đó và lệnh kubectl chép được.
         3. Khối lượng chạy (pod · deployment · khởi động lại) và "nên xem".
         4. Cụm (node · CPU/RAM · cảnh báo VỪA bắn) — nguyên nhân thường nằm ở đây.
         5. Sắp hỏng · vừa có gì đổi (bản mới ra cách đây bao lâu).
         6. Ứng dụng · lưu trữ & mạng (endpoint · hạn mức · ngân sách gián đoạn).
         7. Xu hướng, nếu người dùng bật theo dõi.

       CÂU ĐẦU TIÊN LÀ "CÓ AI ĐANG KHÔNG DÙNG ĐƯỢC KHÔNG", không phải một điểm số
       (sửa 2026-09-17, lần 5). Điểm vẫn còn — nó nói cụm đang tốt lên hay xấu đi —
       nhưng nó KHÔNG trả lời câu người trực hỏi lúc 3 giờ sáng, và đặt nó làm dòng
       to nhất là để một cụm 94 điểm với một Service không có endpoint nào trông
       giống một cụm khoẻ.

       MỖI CÂU LÀ MỘT CARD (sửa 2026-09-17, lần 2). Bản trước chỉ có nhãn in đậm rồi
       nội dung trôi thẳng trên nền trang: ở theme sáng nền trang gần như
       trùng nền panel (trắng) nên bốn khối đọc ra thành một dải chữ liền — đúng
       lỗi đã bị bác ở màn Chi phí và màn Logs. Nay mỗi khối là một `Card` với một hàng tiêu đề
       có gạch chân, và các khối con BÊN TRONG card không còn khung riêng nữa —
       chúng ngăn nhau bằng một hairline. Card-trong-card ở theme sáng là hai đường
       viền lồng nhau quanh cùng một nền trắng, đọc thành lỗi vẽ chứ không ra tầng.

       Vì sao KHÔNG có màn "monitor" riêng: một màn chỉ để tự nạp lại theo nhịp là
       đúng thứ luật "không auto-refresh" cấm. Ở đây có nút BẬT theo dõi (người dùng
       bấm, có trần thời gian, tắt khi rời mục) — vòng lặp do người dùng bật và nhìn
       thấy thì không phải nạp sau lưng ai.

       TỔNG THỂ BÁO CÁO LÀ MỘT HÀNG BIẾT XUỐNG DÒNG (sửa 2026-09-17, lần 4). Một cột
       dọc thì trên màn rộng mọi card đều kéo hết 2000px cho vài con số. Nay hai card
       "hẹp" (`HALF`) đứng cạnh nhau, các card cần bề ngang (`FULL`) ăn trọn hàng.
       FLEX chứ không `grid` + `auto-fit`: một card `1 / -1` chiếm hết mọi track nên
       `auto-fit` hết đường gộp cột, và hai card hẹp bị ghim ở đúng `minmax` với một
       khoảng trắng lớn bên phải. Flex basis thì tự giãn đều và tự xuống dòng. -->
  <div
    class="flex min-h-0 flex-auto flex-wrap content-start items-start gap-3 overflow-x-hidden overflow-y-auto px-3.5 pt-3 pb-4"
  >
    <div :class="[FULL, 'flex flex-wrap items-center gap-2.5']">
      <span
        class="size-2.5 shrink-0 rounded-full"
        :class="LAMP_BG[lamp]"
        role="img"
        :aria-label="lampText"
        :title="lampText"
      />
      <div class="min-w-0 flex-[1_1_12.5rem]">
        <h3 class="text-base font-semibold text-foreground">{{ t('infra.kube.report.title') }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('infra.kube.report.sub') }}</p>
      </div>
      <!-- Phạm vi phải hiện Ở ĐÂY. Thanh chọn cluster nằm ngoài khung cuộn, nên khi
           người dùng cuộn xuống (hoặc chép báo cáo ra ngoài) thì không còn gì nói
           những con số này thuộc cụm/namespace nào. -->
      <!-- mono-ok: `context/namespace` là thứ dán vào kubectl -->
      <code
        class="max-w-55 truncate rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground"
        :title="whereLabel"
      >
        {{ whereLabel }}
      </code>
      <span v-if="whenLabel" class="text-xs text-faint">
        {{ t('infra.kube.report.stale', { when: whenLabel }) }}
      </span>
      <Button
        type="button"
        :disabled="busy"
        :aria-busy="busy"
        :title="t('infra.kube.report.refreshAll')"
        :aria-label="t('infra.kube.report.refreshAll')"
        variant="outline"
        size="iconMd"
        @click="refresh()"
      >
        <Icon name="refresh" :class="{ 'motion-safe:animate-spin': busy }" />
      </Button>
    </div>

    <p v-if="!hasAny" :class="[FULL, 'text-xs text-faint']">{{ t('infra.kube.report.noData') }}</p>

    <template v-else>
      <!-- Điểm + kết luận + việc nên xem trước, trong MỘT card. Bản cũ để điểm ở
           góc trái và câu kết luận trôi sang giữa hàng, nên hai thứ vốn là một câu
           đọc ra thành hai mẩu rời (xem ảnh chụp trong báo lỗi 2026-09-17). -->
      <!-- Màu viền đổi theo đèn: card "có chuyện" phải khác card "ổn" ngay ở đường
           viền, trước khi người đọc kịp đọc con số. -->
      <Card
        :class="[
          FULL,
          'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 p-3.5',
          lamp === 'warn' && 'border-warning/40',
          lamp === 'bad' && 'border-destructive/40',
        ]"
      >
        <div class="flex items-baseline gap-0.5">
          <span class="text-2xl font-semibold tabular-nums" :class="SCORE_TEXT[lamp]">
            {{ score ?? '—' }}
          </span>
          <span class="text-sm text-faint">/100</span>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <!-- CÂU CỦA HERO LÀ "CÓ AI ĐANG KHÔNG DÙNG ĐƯỢC KHÔNG", không phải phán
               quyết chung chung (`lampText`, vẫn còn ở tooltip của đèn). Người trực
               mở màn này để hỏi đúng câu đó; "Có gì đó đáng xem" bắt họ đọc tiếp ba
               khối nữa mới biết có phải chuyện của mình không. -->
          <!-- Màu câu này đi theo `statusLine.bad` (có người dùng đang bị ảnh hưởng hay
               không), KHÔNG theo đèn: đèn bật `warn` cho cả những thứ chưa chạm tới ai,
               và một câu "Không có gì đang ảnh hưởng người dùng" tô amber tự phủ nhận
               chính nó. -->
          <p
            class="text-base font-medium"
            :class="statusLine.bad ? 'text-destructive' : 'text-foreground'"
          >
            {{ statusLine.text }}
          </p>
          <!-- Dải điểm: 100 và 68 khác nhau ở con số, nhưng người đọc nhận ra khác
               biệt ở ĐỘ DÀI trước khi đọc số. -->
          <Progress
            :model-value="score ?? 0"
            aria-hidden="true"
            class="h-1.5 bg-muted"
            :class="METER_FILL[lamp]"
          />
          <span class="text-xs text-faint">
            {{ t('infra.kube.report.score') }} · {{ t('infra.kube.report.scoreNote') }}
          </span>
        </div>
        <!-- Hàng chip: TÊN của vài việc nặng nhất, ngay trong hero. Con số "3 thứ
             đang ảnh hưởng người dùng" không nói được cái gì, và hai card bên dưới
             thì phải cuộn mới tới. -->
        <div v-if="heroChips.length" class="col-span-full flex flex-wrap gap-1.5 border-t pt-2.5">
          <Badge
            v-for="chip in heroChips"
            :key="chip.key"
            variant="outline"
            class="max-w-full items-baseline gap-1.5"
            :class="
              chip.rate === 'warn'
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            "
          >
            <b class="font-semibold">{{ chip.label }}</b>
            <!-- mono-ok: tên object là thứ dán vào kubectl -->
            <code class="truncate font-mono font-normal text-muted-foreground" :title="chip.object">
              {{ chip.object }}
            </code>
          </Badge>
        </div>
      </Card>

      <!-- ── Đang ảnh hưởng người dùng ─────────────────────────────────────── -->
      <Card v-if="impacts.length" :class="[FULL, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.impact') }}
          </span>
          <span class="text-xs text-faint">
            {{ t('infra.kube.report.impactCount', { n: impacts.length }) }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepImpacts
            class="min-w-0 basis-full"
            :items="impacts"
            @open-logs="openPodLogs"
            @open-describe="openPodDescribe"
            @open-terminal="openPodTerminal"
            @copy-cmd="copyCommand"
          />
        </div>
      </Card>

      <!-- ── Khối lượng chạy ───────────────────────────────────────────────── -->
      <Card :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.workload') }}
          </span>
          <span v-if="pods.judged" class="text-xs text-faint">
            {{
              t('infra.kube.report.readyPct', { n: Math.round((pods.ready / pods.judged) * 100) })
            }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepTiles class="min-w-0 basis-full" :tiles="workloadTiles" />

          <!-- Danh sách Deployment: ô số phía trên nói "5/6 đủ bản sao", khối này
               nói CÁI NÀO, ảnh nào đang chạy, và cái nào đang kẹt giữa hai bản. -->
          <div v-if="deployRows.length" :class="[BLOCK, 'basis-full']">
            <span class="text-xs text-muted-foreground">
              {{ t('infra.kube.deploys.tab', { n: deploys.total }) }}
            </span>
            <KubeRepDeploys :rows="deployRows" />
          </div>

          <div v-if="pods.statuses.length" :class="BLOCK">
            <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.statuses') }}</span>
            <KubeRepDonut :statuses="pods.statuses" :label="t('infra.kube.report.statuses')" />
          </div>

          <div v-if="pods.top.length" :class="BLOCK">
            <span class="text-xs text-muted-foreground">
              {{ t('infra.kube.report.topRestarts') }}
            </span>
            <!-- Tên pod và số lần khởi động lại là hai mẩu khác loại: dính liền nhau thì
                 "api-7d9c-def7" đọc ra như một cái tên. -->
            <ul class="list-disc pl-4.5 text-sm text-foreground">
              <li v-for="row in pods.top" :key="row.name">
                <span class="inline-flex flex-wrap items-baseline gap-2">
                  <!-- mono-ok: tên pod là thứ dán vào kubectl -->
                  <code class="font-mono">{{ row.name }}</code>
                  <span class="tabular-nums">{{ row.n }}</span>
                  <!-- `(2m ago)` của kubectl: 3 lần restart hôm qua và 3 lần trong 2
                     phút vừa rồi là hai tình huống khác nhau hẳn. -->
                  <span v-if="row.ago" class="text-xs text-warning">
                    {{ t('infra.kube.report.lastRestart', { ago: row.ago }) }}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </Card>

      <!-- ── Nên xem ───────────────────────────────────────────────────────── -->
      <Card v-if="findings.length" :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.findings') }}
          </span>
          <span class="text-xs text-faint">{{ findings.length }}</span>
        </div>
        <div :class="SEC_BODY">
          <!-- CÙNG hình dạng hàng với card "Đang ảnh hưởng người dùng" (sửa
               2026-09-17): chip phân loại + câu + nút mở đúng pod khi dòng nói về
               một pod. Trước đó đây là danh sách chữ trần — đọc xong vẫn phải tự gõ
               lại tên pod vào terminal, đúng việc mà cả màn này sinh ra để khỏi phải
               làm. -->
          <KubeRepImpacts
            class="min-w-0 basis-full"
            :items="findings"
            @open-logs="openPodLogs"
            @open-describe="openPodDescribe"
            @open-terminal="openPodTerminal"
            @copy-cmd="copyCommand"
          />
        </div>
      </Card>

      <!-- ── Cụm: node · CPU/RAM · cảnh báo ────────────────────────────────── -->
      <Card :class="[FULL, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.cluster') }}
          </span>
          <span v-if="nodesStat.total" class="text-xs text-faint">
            {{ t('infra.kube.report.m.nodes') }} {{ nodesStat.ready }}/{{ nodesStat.total }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepTiles
            v-if="clusterTiles.length"
            class="min-w-0 basis-full"
            :tiles="clusterTiles"
          />

          <KubeRepNodes
            v-if="hasNodes || gapOf('nodes')"
            class="min-w-0 basis-full"
            :nodes="nodesStat.all"
            :versions="nodesStat.versions"
            :capacity="capacityByNode"
            :gap="gapOf('nodes')"
          />

          <KubeRepUsage
            v-if="hasUsage || gapOf('top')"
            class="min-w-0 basis-full"
            :nodes="nodeUse"
            :pods-on="nodePods"
            :capacity="capacityByNode"
            :top-cpu="usage.topCpu"
            :top-mem="usage.topMem"
            :pod-count="usage.n"
            :cpu-label="usage.cpuLabel"
            :mem-label="usage.memLabel"
            :gap="gapOf('top')"
          />

          <KubeRepEvents
            class="min-w-0 basis-full"
            :groups="freshGroups"
            :more="freshMore"
            :lines="eventStat.lines"
            :fresh-lines="eventFresh.freshLines"
            :stale-lines="eventFresh.staleLines"
            :window-min="CHANGE_WINDOW_MIN"
            :gap="gapOf('events')"
          />
        </div>
      </Card>

      <!-- ── Sắp hỏng ──────────────────────────────────────────────────────
           Tách khỏi card "Đang ảnh hưởng người dùng" có chủ đích: hạn mức còn 12%
           và một Service không có endpoint nào là hai mức khẩn cấp khác nhau, và
           trộn chúng là bắt người trực tự phân loại lại đúng lúc họ ít bình tĩnh
           nhất (xem docblock `ReportItemKind` trong composable). -->
      <Card :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.risk') }}
          </span>
          <span v-if="risks.length" class="text-xs text-faint">{{ risks.length }}</span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepRisks class="min-w-0 basis-full" :items="risks" />
        </div>
      </Card>

      <!-- ── Vừa có gì đổi ─────────────────────────────────────────────────
           "Bản mới ra cách đây bao lâu" là câu hỏi ĐẦU TIÊN khi một dịch vụ vừa
           hỏng, và không bảng nào khác trên màn này trả lời được: `get pods` chỉ
           nói tuổi pod (restart cũng làm nó trẻ lại), `get deploy` nói tuổi
           Deployment (không đổi khi deploy bản mới). ReplicaSet trẻ nhất mới là
           bản vừa tung ra. -->
      <Card :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.changed') }}
          </span>
          <span v-if="rollout" class="text-xs text-faint">{{ rollout.name }}</span>
        </div>
        <div :class="SEC_BODY">
          <p
            v-if="gapOf('replicasets')"
            class="flex min-w-0 basis-full flex-col gap-0.5 text-sm text-foreground"
          >
            {{ t('infra.kube.report.gap.replicasets') }}
            <span class="text-xs text-faint">{{ gapOf('replicasets') }}</span>
          </p>
          <p
            v-else-if="rolloutAgo"
            class="flex min-w-0 basis-full flex-col gap-0.5 text-sm text-foreground"
          >
            {{ t('infra.kube.report.lastRollout', { ago: rolloutAgo }) }}
          </p>
          <p v-else class="min-w-0 basis-full text-xs text-faint">
            {{ t('infra.kube.report.noRollout') }}
          </p>
        </div>
      </Card>

      <!-- ── Ứng dụng: tự co giãn + workload không phải Deployment ─────────── -->
      <Card :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.apps') }}
          </span>
          <span v-if="otherWorkloads.bad.length" class="text-xs text-faint">
            {{ t('infra.kube.report.badN', { n: otherWorkloads.bad.length }) }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepHpa class="min-w-0 basis-full" :list="hpa.list" :gap="gapOf('hpa')" />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.sts')"
            :items="stsChips"
            :empty="t('infra.kube.report.stsNone')"
            :gap="gapOf('statefulsets')"
          />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.ds')"
            :items="dsChips"
            :empty="t('infra.kube.report.dsNone')"
            :gap="gapOf('daemonsets')"
          />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.jobs')"
            :items="jobChips"
            :empty="t('infra.kube.report.jobsNone')"
            :gap="gapOf('jobs')"
          />
        </div>
      </Card>

      <!-- ── Lưu trữ + mạng ───────────────────────────────────────────────── -->
      <Card :class="[HALF, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.storageNet') }}
          </span>
          <span v-if="storage.total" class="text-xs text-faint">
            {{ t('infra.kube.report.pvcSum', { n: storage.total, size: storage.label }) }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.pvc')"
            :items="pvcChips"
            :empty="t('infra.kube.report.pvcNone')"
            :gap="gapOf('pvc')"
          />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.svc')"
            :items="svcChips"
            :empty="t('infra.kube.report.svcNone')"
            :gap="gapOf('services')"
          />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.ing')"
            :items="ingChips"
            :empty="t('infra.kube.report.ingNone')"
            :gap="gapOf('ingresses')"
          />
          <!-- Endpoint đi NGAY SAU Service: một Service có dòng đẹp trong `get svc`
               mà không có pod nào đứng sau thì mọi request vào nó nhận 503, và bảng
               endpoints là chỗ duy nhất trong các lệnh `get` nói ra điều đó. -->
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.endpoints')"
            :items="endpointChips"
            :empty="t('infra.kube.report.endpointsNone')"
            :gap="gapOf('endpoints')"
          />
          <KubeRepQuota
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.quota')"
            :list="quota"
            :empty="t('infra.kube.report.quotaNone')"
            :gap="gapOf('resourcequota')"
          />
          <KubeRepChips
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.pdb')"
            :items="pdbChips"
            :empty="t('infra.kube.report.pdbNone')"
            :gap="gapOf('pdb')"
          />
        </div>
      </Card>

      <!-- ── Theo dõi + xu hướng ───────────────────────────────────────────── -->
      <Card :class="[FULL, SEC]">
        <div :class="SEC_HEAD">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.kube.report.watchSec') }}
          </span>
          <span v-if="trend && trend.n > 1" class="text-xs text-faint">
            {{ t('infra.kube.report.series', { n: trend.n, from: fromLabel }) }}
          </span>
        </div>
        <div :class="SEC_BODY">
          <div class="flex min-w-0 basis-full flex-wrap items-center gap-2">
            <Button type="button" :aria-pressed="watching" variant="outline" @click="toggleWatch()">
              <Icon :name="watching ? 'stop' : 'play'" />
              {{
                watching
                  ? t('infra.kube.report.monitorStop')
                  : t('infra.kube.report.monitor', { sec: WATCH_SECONDS })
              }}
            </Button>
            <span v-if="watching" class="text-xs text-faint" role="status">
              {{ t('infra.kube.report.monitorOn', { when: lastLabel || '—' }) }}
            </span>
            <span v-else class="text-xs text-faint">
              {{ t('infra.kube.report.monitorCap', { min: WATCH_MINUTES }) }}
            </span>
          </div>

          <!-- BIỂU ĐỒ THẬT, KHÔNG PHẢI SPARKLINE (đổi 2026-09-17). Bản trước là ba
               polyline trần trong một khung 300×60: không trục, không mốc thời gian,
               không tooltip — đọc được "đang lên hay đang xuống" và hết. Ở đây dùng
               lại `MetricChart` của màn Giám sát, nên xu hướng cụm và xu hướng
               CloudWatch có CÙNG một cách đọc.
               Hai khung chứ không một: phần trăm và số pod là hai đơn vị, ép chung
               một trục thì đường nào cũng sai. -->
          <MetricChart
            v-if="trendWindow"
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.chartHealth')"
            kind="line"
            unit="Percent"
            :series="healthSeries"
            :window="trendWindow"
            :window-seconds="trendSeconds"
            :period-seconds="WATCH_SECONDS"
            :incidents="rolloutBands"
            :threshold="null"
          />
          <MetricChart
            v-if="trendWindow"
            class="min-w-0 basis-full"
            :title="t('infra.kube.report.chartPods')"
            kind="area"
            unit="Count"
            :series="podSeries"
            :window="trendWindow"
            :window-seconds="trendSeconds"
            :period-seconds="WATCH_SECONDS"
            :incidents="rolloutBands"
            :threshold="null"
          />
        </div>
      </Card>

      <div :class="[FULL, 'flex flex-wrap gap-2']">
        <Button type="button" variant="outline" @click="copyReport()">
          <Icon name="copy" />
          {{ t('infra.kube.report.copy') }}
        </Button>
        <Button type="button" variant="outline" @click="askAboutReport()">
          <Icon name="message" />
          {{ t('infra.kube.report.ask') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Màn Báo cáo (mục 3 của vùng bảng trong tab Kubernetes). Component chỉ HIỂN THỊ;
// mọi phép tính nằm ở `useInfraKubeReport()` (khuôn page-controller của
// .claude/rules/nuxt-vue.md). Các khối con nằm trong `report/`.
//
// Phần "tính" còn sót lại ở đây đúng bằng phần TRÌNH BÀY: gộp `ReportItem` thành
// chip, dựng chuỗi cho từng hàng deployment, cắt danh sách cho vừa màn. Không có
// ngưỡng nào, không có phép so sánh nào quyết định "ổn hay không" — chúng ở
// composable, để bản chép ra (`reportText`) và màn hình không bao giờ nói lệch nhau.
import {
  CHANGE_WINDOW_MIN,
  KUBE_WATCH_MAX_MS,
  KUBE_WATCH_MS,
  KUBE_WATCH_SECONDS,
  RECENT_RESTART_MIN,
  usageRate,
  useInfraKubeReport,
} from '~/composables/useInfraKubeReport'
import type { ChipItem, KubeRate, KubeRepTile } from '~/composables/useInfraKubeReport'
import type { ChartSeriesView, IncidentBand } from '~/composables/useInfraMetrics'
import type { WorkloadStat } from '~/utils/kube-report'
import type { InfraKubeController } from '~/composables/useInfraKube'
import { copyText } from '~/utils/clipboard'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ kube: InfraKubeController }>()
const kube = props.kube
const { t } = useI18n()
const toast = useToast()

// ── Bố cục ────────────────────────────────────────────────────────────────────
/** Con của hàng báo cáo: mặc định chiếm trọn một hàng. */
const FULL = 'min-w-0 flex-[1_1_100%]'
/** Hai card chịu được nửa hàng. Basis 340px, không phải bề rộng: hai cái cạnh nhau
 *  cần ≥ 700px mới đứng chung hàng, dưới mức đó chúng tự tách. */
const HALF = 'min-w-0 flex-[1_1_21.25rem]'
/** Card của một câu trong báo cáo: một hàng tiêu đề có gạch chân + một thân. */
const SEC = 'gap-0 py-0'
/** Hàng tiêu đề KHÔNG phải thanh cao cố định nên `border-b` ở đây là đúng chỗ. */
const SEC_HEAD = 'flex flex-wrap items-baseline justify-between gap-2.5 border-b px-3.5 py-2'
/** THÂN CARD CŨNG LÀ MỘT HÀNG BIẾT XUỐNG DÒNG: xếp dọc thì "Theo trạng thái" và
 *  "Khởi động lại nhiều nhất" mỗi khối ăn trọn bề ngang cho vài chữ. Các khối ngăn
 *  nhau bằng hairline ở CẠNH TRÊN (trừ khối đầu), không bằng khung riêng: card
 *  trong card ở theme sáng là hai đường viền lồng nhau quanh cùng một nền trắng. */
const SEC_BODY =
  'flex min-w-0 flex-wrap content-start items-start gap-x-7 gap-y-3 px-3.5 py-3 *:not-first:border-t *:not-first:pt-3'
/** Khối hẹp trong thân card (trạng thái pod · restart nhiều nhất). */
const BLOCK = 'flex min-w-0 flex-[1_1_18.75rem] flex-col gap-1.5'

// ── Màu theo đèn ──────────────────────────────────────────────────────────────
const LAMP_BG: Record<KubeRate, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  unknown: 'bg-faint',
}
const SCORE_TEXT: Record<KubeRate, string> = {
  ok: 'text-foreground',
  warn: 'text-warning',
  bad: 'text-destructive',
  unknown: 'text-foreground',
}
/** Dải điểm: 100 và 68 khác nhau ở con số, nhưng người đọc nhận ra khác biệt ở ĐỘ
 *  DÀI trước khi đọc số. Màu thanh đi theo đèn. */
const METER_FILL: Record<KubeRate, string> = {
  ok: '*:data-[slot=progress-indicator]:bg-success',
  warn: '*:data-[slot=progress-indicator]:bg-warning',
  bad: '*:data-[slot=progress-indicator]:bg-destructive',
  unknown: '*:data-[slot=progress-indicator]:bg-success',
}

const {
  whereLabel,
  busy,
  pods,
  deploys,
  nodesStat,
  hasNodes,
  nodeUse,
  nodePods,
  capacityByNode,
  hpa,
  otherWorkloads,
  storage,
  network,
  saturation,
  usage,
  hasUsage,
  eventStat,
  eventFresh,
  restarts15,
  endpoints,
  quota,
  pdbs,
  rollout,
  impacts,
  risks,
  statusLine,
  gaps,
  hasAny,
  score,
  lamp,
  lampText,
  findings,
  trend,
  samples,
  watching,
  lastLabel,
  whenLabel,
  fromLabel,
  refresh,
  toggleWatch,
  copyReport,
  askAboutReport,
} = useInfraKubeReport(kube)

const WATCH_SECONDS = KUBE_WATCH_SECONDS
const WATCH_MINUTES = Math.round(KUBE_WATCH_MAX_MS / 60_000)
/** Bao nhiêu chip trong hero. Ba + hai là trần của MỘT hàng đọc lướt được; quá đó
 *  thì hero biến thành bản sao thứ hai của hai card ngay bên dưới nó. */
const HERO_IMPACTS = 3
const HERO_RISKS = 2
/** Bao nhiêu nhóm cảnh báo được vẽ. Cùng con số với `TOP_N` của composable — nó
 *  không export, và một hằng số 5 ở đây rẻ hơn việc mở rộng API của composable. */
const EVENT_ROWS = 5

/** Lý do một nguồn số không đọc được, theo khoá — rỗng nghĩa là đọc được. */
function gapOf(key: string): string {
  return gaps.value.find((g) => g.key === key)?.why ?? ''
}

/** Một nhóm workload → chip: tên + con số sẵn sàng + mức. */
function chipsOf(list: WorkloadStat[]): ChipItem[] {
  return list.map((w) => ({
    name: w.name,
    value: w.status ? `${w.ready} · ${w.status}` : w.ready,
    rate: w.ok ? ('ok' as const) : ('bad' as const),
  }))
}

const stsChips = computed<ChipItem[]>(() => chipsOf(otherWorkloads.value.sts))
const dsChips = computed<ChipItem[]>(() => chipsOf(otherWorkloads.value.ds))
const jobChips = computed<ChipItem[]>(() => chipsOf(otherWorkloads.value.jobs))

const pvcChips = computed<ChipItem[]>(() =>
  storage.value.list.map((v) => ({
    name: v.name,
    value: v.bound ? v.capacity : v.status,
    rate: v.bound ? ('ok' as const) : ('bad' as const),
  })),
)

const svcChips = computed<ChipItem[]>(() =>
  network.value.svc.map((x) => ({
    name: x.name,
    // Địa chỉ ngoài chỉ có nghĩa với LoadBalancer; ClusterIP thì kiểu dịch vụ CHÍNH
    // LÀ thông tin (không ai vào được từ ngoài, và đó là chủ ý).
    value: x.type === 'LoadBalancer' ? x.externalIp : x.type,
    rate: x.pending ? ('warn' as const) : ('ok' as const),
  })),
)

const ingChips = computed<ChipItem[]>(() =>
  network.value.ing.map((x) => ({
    name: x.name,
    value: x.pending ? x.hosts : x.address,
    rate: x.pending ? ('warn' as const) : ('ok' as const),
  })),
)

const endpointChips = computed<ChipItem[]>(() =>
  endpoints.value.map((e) => ({
    name: e.name,
    value: e.empty
      ? t('infra.kube.report.endpointsEmpty')
      : t('infra.kube.report.endpointsN', { n: e.count }),
    rate: e.empty ? ('bad' as const) : ('ok' as const),
  })),
)

const pdbChips = computed<ChipItem[]>(() =>
  pdbs.value.map((p) => ({
    name: p.name,
    // PDB chặn drain là `warn`, không phải `bad`: chưa ai mất dịch vụ vì nó — nó
    // chỉ làm `kubectl drain` treo vô hạn khi tới lượt nâng cấp node.
    value: p.blocked
      ? `${t('infra.kube.report.pdbBlocked')} · ${t('infra.kube.report.pdbBlockedWhy')}`
      : t('infra.kube.report.pdbAllowed', { n: p.allowed ?? 0 }),
    rate: p.blocked ? ('warn' as const) : ('ok' as const),
  })),
)

// ── Hero: vài cái tên, không chỉ vài con số ─────────────────────────────────
const heroChips = computed(() => [
  ...impacts.value.slice(0, HERO_IMPACTS).map((item) => ({
    key: item.key,
    label: item.label,
    object: item.object,
    rate: 'bad' as const,
  })),
  ...risks.value.slice(0, HERO_RISKS).map((item) => ({
    key: item.key,
    label: item.label,
    object: item.object,
    rate: 'warn' as const,
  })),
])

// ── Mở một pod từ danh sách việc ────────────────────────────────────────────
function openPodLogs(pod: string): void {
  void kube.openLogs(pod)
}

function openPodDescribe(pod: string): void {
  void kube.openDescribe(pod)
}

/**
 * Terminal của pod = mở khung output cho ĐÚNG pod đó rồi đổi tab.
 *
 * `await` không phải thói quen: `setOutMode` tự bỏ qua khi khung đang nạp (hai
 * lệnh chồng nhau trên cùng một khung thì kết quả về muộn của tab cũ nằm dưới
 * tiêu đề của tab mới), nên gọi song song sẽ im lặng dừng ở tab Log.
 */
async function openPodTerminal(pod: string): Promise<void> {
  await kube.openLogs(pod)
  await kube.setOutMode('terminal')
}

async function copyCommand(command: string): Promise<void> {
  if (!(await copyText(command))) {
    toast.add({ title: t('infra.kube.report.act.copyFailed'), color: 'error', icon: 'alert' })
    return
  }
  toast.add({ title: t('infra.kube.report.act.copied'), color: 'success', icon: 'copy' })
}

// ── Deployment + rollout ────────────────────────────────────────────────────
/**
 * `ageSec` → nhãn ngắn kiểu cột AGE của kubectl (`45s` · `12m` · `3h` · `2d`).
 *
 * Viết ở đây chứ không dùng `utils/relative-time.ts`: hai hàm bên đó nhận một
 * chuỗi ISO, còn thứ đọc được từ bảng kubectl là một SỐ GIÂY đã bóc sẵn — đi
 * đường vòng qua ISO chỉ để quay lại cùng con số là thêm một chỗ để lệch múi giờ.
 */
function agoOf(sec: number | null): string {
  if (sec === null) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86_400)}d`
}

const deployRows = computed(() =>
  deploys.value.list.map((d) => ({
    key: d.name,
    name: d.name,
    ready: `${d.ready}/${d.desired}`,
    rolling: d.rollingOut,
    rollout: d.rollingOut
      ? t('infra.kube.report.rolloutStuck', { done: d.upToDate ?? 0, total: d.desired })
      : '',
    image: d.images[0] ?? '',
    age: agoOf(d.ageSec),
  })),
)

const rolloutAgo = computed(() => (rollout.value ? agoOf(rollout.value.ageSec) : ''))

/**
 * Mốc "bản mới ra" trên biểu đồ theo dõi.
 *
 * Vì sao nó đáng nằm TRÊN biểu đồ chứ không chỉ trong card "Vừa có gì đổi": câu
 * duy nhất người ta muốn đọc từ hai đường này là "nó tệ đi TỪ LÚC NÀO", và câu trả
 * lời gần như luôn là "từ lúc deploy".
 *
 * `Date.now()` trong computed là ảnh chụp lúc `rollout` đổi (tức lúc nạp lại bảng
 * ReplicaSet), không phải một giá trị sống — đúng như vậy: mốc này phải đứng yên
 * trên trục trong lúc biểu đồ chạy.
 */
const rolloutBands = computed<IncidentBand[]>(() => {
  const at = rollout.value?.ageSec
  if (at === null || at === undefined) return []
  const startMs = Date.now() - at * 1000
  // Một dải rộng 0 không vẽ ra pixel nào; lấy đúng MỘT nhịp đọc làm bề rộng.
  return [{ startMs, endMs: startMs + KUBE_WATCH_MS, label: t('infra.kube.report.rolloutMark') }]
})

// ── Cảnh báo: chỉ vẽ nhóm TƯƠI ──────────────────────────────────────────────
const freshGroups = computed(() => eventFresh.value.fresh.slice(0, EVENT_ROWS))
const freshMore = computed(() => Math.max(0, eventFresh.value.fresh.length - EVENT_ROWS))

// ── Biểu đồ xu hướng ────────────────────────────────────────────────────────
/** Khung thời gian của dải mẫu. Dưới hai mẫu thì không có "xu hướng" nào để vẽ. */
const trendWindow = computed(() => {
  const list = samples.value
  const first = list[0]
  const last = list[list.length - 1]
  if (!first || !last || list.length < 2) return null
  return { startMs: first.t, endMs: last.t }
})

const trendSeconds = computed(() => {
  const w = trendWindow.value
  return w ? Math.max(KUBE_WATCH_SECONDS, Math.round((w.endMs - w.startMs) / 1000)) : 0
})

/** Điểm của một chuỗi: mẫu KHÔNG đo được bị bỏ hẳn, không quy về 0 — `MetricChart`
 *  tự nối qua khoảng trống, còn một điểm 0 giả là nói cụm đã tụt về 0. */
function pointsOf(pick: (s: (typeof samples.value)[number]) => number | null) {
  return samples.value
    .map((s) => ({ t: s.t, v: pick(s) }))
    .filter((p): p is { t: number; v: number } => p.v !== null)
}

function seriesOf(
  key: string,
  label: string,
  color: string,
  shade: number,
  pick: (s: (typeof samples.value)[number]) => number | null,
): ChartSeriesView {
  const points = pointsOf(pick)
  return { key, label, color, shade, points, missing: points.length === 0 }
}

const healthSeries = computed<ChartSeriesView[]>(() => [
  seriesOf('score', t('infra.kube.report.trendScore'), 'var(--accent)', 1, (s) => s.score),
  seriesOf('cpu', t('infra.kube.report.trendCpu'), 'var(--amber)', 1, (s) => s.cpuPct),
  seriesOf('mem', t('infra.kube.report.trendMem'), 'var(--blue)', 1, (s) => s.memPct),
])

const podSeries = computed<ChartSeriesView[]>(() => [
  seriesOf('notReady', t('infra.kube.report.trendNotReady'), 'var(--danger)', 1, (s) => s.notReady),
  seriesOf(
    'restarts',
    t('infra.kube.report.trendRestarts'),
    'var(--textMuted)',
    1,
    (s) => s.restarts,
  ),
])

function pctLabel(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

/** Ô số của khối "Khối lượng chạy": pod và deployment — thứ người dùng vừa xem ở
 *  hai mục bên cạnh, nhưng ở dạng tổng. */
const workloadTiles = computed<KubeRepTile[]>(() => {
  const p = pods.value
  const d = deploys.value
  const out: KubeRepTile[] = [
    {
      key: 'pods',
      label: t('infra.kube.report.m.pods'),
      value: p.judged ? `${p.ready}/${p.judged}` : '—',
      sub: p.judged
        ? t('infra.kube.report.readyPct', { n: Math.round((p.ready / p.judged) * 100) })
        : undefined,
      rate: p.judged === 0 ? 'unknown' : p.ready >= p.judged ? 'ok' : 'bad',
    },
    {
      key: 'notReady',
      label: t('infra.kube.report.m.notReady'),
      value: String(p.notReady),
      rate: p.notReady > 0 ? 'bad' : 'ok',
    },
    {
      key: 'restarts',
      label: t('infra.kube.report.m.restarts'),
      value: String(p.restarts),
      // Số/pod là bối cảnh; "vừa restart" là tin. Ưu tiên tin.
      sub:
        p.recent > 0
          ? t('infra.kube.report.recentRestarts', { n: p.recent, min: RECENT_RESTART_MIN })
          : p.total
            ? t('infra.kube.report.perPod', { n: (p.restarts / p.total).toFixed(1) })
            : undefined,
      rate: p.recent > 0 ? 'bad' : p.restarts > 0 ? 'warn' : 'ok',
    },
    // Ô "khởi động lại" bên trái đếm TÍCH LUỸ từ lúc pod sinh ra; ô này đếm số pod
    // có lần restart TRONG cửa sổ. Một cụm 40 restart từ tuần trước và một cụm 2
    // restart trong 15 phút vừa rồi là hai chuyện khác hẳn nhau.
    {
      key: 'restartWindow',
      label: t('infra.kube.report.m.restartWindow'),
      value: String(restarts15.value),
      sub: t('infra.kube.report.podsInWindow', { min: CHANGE_WINDOW_MIN }),
      rate: restarts15.value > 0 ? 'bad' : 'ok',
    },
  ]
  // Ô deployment chỉ có mặt khi THẬT SỰ có hàng deployment: một cụm chưa nạp được
  // bảng deployment không được hiện "0/0 đủ bản sao" (câu đó vừa vô nghĩa vừa sai).
  if (d.total > 0) {
    out.push({
      key: 'deploys',
      label: t('infra.kube.report.m.deploys'),
      value: `${d.full}/${d.total}`,
      sub:
        d.desired > 0
          ? t('infra.kube.report.replicas', { ready: d.ready, n: d.desired })
          : undefined,
      rate: d.full >= d.total ? 'ok' : 'bad',
    })
    // Rollout kẹt KHÔNG hiện ra ở ô bên cạnh: `READY` vẫn đủ vì pod bản cũ còn
    // đang phục vụ. Đây là ô duy nhất trên màn nói ra chuyện đó bằng một con số.
    out.push({
      key: 'rolloutStuck',
      label: t('infra.kube.report.m.rolloutStuck'),
      value: String(d.stuck.length),
      sub: t('infra.kube.report.ofDeploys', { n: d.total }),
      rate: d.stuck.length > 0 ? 'bad' : 'ok',
    })
  }
  // Cảnh báo VỪA bắn. Chỉ có ô này khi bảng event đọc được: "0 cảnh báo mới" cho
  // một namespace không đọc nổi event là một con số SAI, không phải con số thiếu.
  if (!gapOf('events')) {
    out.push({
      key: 'freshEvents',
      label: t('infra.kube.report.m.freshEvents'),
      value: String(eventFresh.value.freshLines),
      sub: t('infra.kube.report.inWindow', { min: CHANGE_WINDOW_MIN }),
      rate: eventFresh.value.freshLines > 0 ? 'warn' : 'ok',
    })
  }
  // Pod đã chạy xong (Job/CronJob) là chuyện bình thường, nhưng phải NÓI RA: không
  // nói thì người dùng thấy "11/12 sẵn sàng" và đi tìm pod thứ 12 vô ích.
  if (p.finished > 0) {
    out.push({
      key: 'finished',
      label: t('infra.kube.report.m.finished'),
      value: String(p.finished),
    })
  }
  return out
})

/** Ô số của khối "Cụm": node · CPU/RAM cao nhất · số dòng cảnh báo. Mỗi ô chỉ có
 *  mặt khi nguồn của nó đọc được — ô "0%" cho một cụm không đo được CPU là con số
 *  sai, không phải con số thiếu. */
const clusterTiles = computed<KubeRepTile[]>(() => {
  const out: KubeRepTile[] = []
  const n = nodesStat.value
  const sat = saturation.value
  if (n.total > 0) {
    out.push({
      key: 'nodes',
      label: t('infra.kube.report.m.nodes'),
      value: `${n.ready}/${n.total}`,
      sub: n.cordoned.length
        ? t('infra.kube.report.cordonedN', { n: n.cordoned.length })
        : undefined,
      rate: n.notReady.length > 0 ? 'bad' : n.cordoned.length > 0 ? 'warn' : 'ok',
    })
  }
  if (sat.maxCpuPct !== null) {
    out.push({
      key: 'cpu',
      label: t('infra.kube.report.m.cpu'),
      value: pctLabel(sat.maxCpuPct),
      sub: t('infra.kube.report.ofNodes', { n: nodeUse.value.length }),
      rate: usageRate(sat.maxCpuPct),
    })
  }
  if (sat.maxMemPct !== null) {
    out.push({
      key: 'mem',
      label: t('infra.kube.report.m.mem'),
      value: pctLabel(sat.maxMemPct),
      sub: t('infra.kube.report.ofNodes', { n: nodeUse.value.length }),
      rate: usageRate(sat.maxMemPct),
    })
  }
  if (eventStat.value.lines > 0) {
    out.push({
      key: 'events',
      label: t('infra.kube.report.m.events'),
      value: String(eventStat.value.lines),
      sub: t('infra.kube.report.eventGroups', { n: eventStat.value.groups.length }),
      rate: eventStat.value.bad > 0 ? 'bad' : 'warn',
    })
  }
  return out
})
</script>
