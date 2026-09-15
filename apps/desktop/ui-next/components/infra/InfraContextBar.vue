<template>
  <!-- Thanh ngữ cảnh của `/infra` (docs/features/infra-explorer.md §"Bố cục màn
       hình": "Thanh ngữ cảnh đầu trang là control DUY NHẤT chọn tài khoản").

       VÌ SAO NÓ NẰM Ở ĐÂY, TRONG HÀNG TAB. Yêu cầu 2026-09-14: "đưa dropdown
       account lên trên đầu, các dịch vụ, service phải theo account đó". Trước đó
       tài khoản chỉ đổi được ở tab Tài khoản — tức người đang xem tab Dịch vụ
       phải đi vòng sang tab khác, đổi, rồi quay lại, và trong lúc đi vòng thì
       không có gì trên màn nói bảng đang đọc tài khoản nào. Hàng tab là chỗ duy
       nhất trên trang luôn hiển thị, ở mọi tab.

       MỘT dropdown, KHÔNG phải hai (2026-09-14: "gộp cả 2 trong 1 dropdown đi").
       Trước đó là hai ô `AppSelect` cạnh nhau (Profile AWS · Region), rồi Region
       được ẩn sau một nút. Cả hai bản đều sai một chỗ: profile và region là HAI
       NỬA CỦA MỘT ngữ cảnh — cùng đi vào một lệnh `aws`, cùng đổi khi người dùng
       chuyển tài khoản — nên tách chúng thành hai control là bắt người đọc ghép
       lại thông tin ở hai nơi. Nay là một trigger hiện cả hai giá trị
       ("dev-sandbox · Theo profile"), và menu xổ ra hai mục: Profile AWS ở trên,
       Region ở dưới. Chọn profile thì region đi theo (luật ở `useInfraPage`).

       MỖI MỤC MỘT Ô TÌM, KHÔNG PHẢI MỘT Ô CHUNG (2026-09-14: "trong dropbox thì
       các mục phải để là SearchableCombobox chứ?" ⇒ "SearchableCombobox cho từng
       mục riêng biệt chứ sao lại 1 mục chung vậy?"). Danh sách region chuẩn đã
       hơn 30 mục và danh sách profile dài bao nhiêu là do `~/.aws` của người dùng
       quyết — chính tab Tài khoản đã phải có ô tìm riêng cho profile. Một ô tìm
       chung lọc cả hai danh sách nghe thì gọn, nhưng nó trả lời sai câu người
       dùng đang hỏi: gõ một mã region thì mục Profile biến mất, và ngược lại —
       hai câu hỏi khác nhau bị một ô chữ trả lời chung.

       KHÔNG có picker tài khoản thứ hai ở dưới: cả bảng tài nguyên lẫn danh mục
       đều derive từ `settings.infra` — đúng ADR 0088 §7 và đúng lý do "hai bảng
       cạnh nhau nói về hai tài khoản khác nhau mà không ai nhận ra". -->
  <div class="ictx">
    <span class="ictx-lbl">{{ t('infra.pop.title') }}</span>
    <span class="iwrap">
      <button
        type="button"
        class="ictx-btn"
        :class="{ on: open }"
        :title="t('infra.bar.hint')"
        aria-haspopup="listbox"
        :aria-expanded="open"
        @click="open = !open"
      >
        <Icon name="layers" class="ictx-ic" />
        <span class="ictx-val">
          <span class="ictx-who">{{ profileLabel }}</span>
          <span class="ictx-dot">·</span>
          <span class="ictx-where">{{ regionLabel }}</span>
        </span>
        <Icon name="chev" class="ictx-chev" :class="{ open }" />
      </button>

      <template v-if="open">
        <div class="ibackdrop" @click="close" />
        <div class="pop ipop ictx-pop" @click.stop>
          <!-- MỖI MỤC MỘT Ô TÌM RIÊNG (2026-09-14: "SearchableCombobox cho từng
               mục riêng biệt chứ sao lại 1 mục chung vậy?"). Một ô tìm chung lọc
               cả hai danh sách nghe thì gọn, nhưng nó trả lời sai câu người dùng
               đang hỏi: gõ một mã region thì mục Profile biến mất, và ngược lại —
               hai câu hỏi khác nhau ("tài khoản nào" và "ở đâu") bị một ô chữ trả
               lời chung. Nay mỗi mục có ô tìm của chính nó, đứng ngay trên danh
               sách nó lọc.

               Focus ở lại trong ô tìm — mọi phím điều hướng đều bắt từ đó, nên
               không có chuyện bấm ↓ rồi "mất dấu" vì focus đã nhảy xuống một hàng. -->
          <div class="ictx-sec" role="group" :aria-label="t('infra.profile.label')">
            <div class="ilbl">{{ t('infra.profile.label') }}</div>
            <label class="srch ictx-srch">
              <Icon name="search" />
              <input
                ref="profileSearchEl"
                v-model="profileQuery"
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="ictx-list-profile"
                :aria-expanded="true"
                :aria-activedescendant="activeId"
                :placeholder="t('infra.bar.searchProfile')"
                @keydown="onKeydown"
              />
            </label>
            <!-- `Quản lý profile…` là LỐI ĐI chứ không phải một giá trị, nên nó ở
                 cuối danh sách và không bao giờ được tick. -->
            <div
              id="ictx-list-profile"
              ref="profileListEl"
              class="ictx-list"
              role="listbox"
              :aria-label="t('infra.profile.label')"
            >
              <div
                v-for="(p, i) in shownProfiles"
                :id="`ictx-o-${i}`"
                :key="p.value"
                class="ictx-opt"
                :class="{ on: p.value === profile, 'ictx-cur': active === i }"
                role="option"
                :aria-selected="p.value === profile"
                @mouseenter="setActive(i)"
                @click="pickProfile(p.value)"
              >
                <span class="ictx-opt-l">{{ p.label }}</span>
                <Icon v-if="p.value === profile" name="check" class="ictx-tick" />
              </div>
              <!-- Vì sao danh sách trống — ba nguyên nhân khác nhau, ba câu khác
                   nhau, và ở trong menu thì có chỗ nói câu ĐẦY ĐỦ. Câu này hiện
                   cả khi còn một hàng "Quản lý profile…": lượt đọc `~/.aws` hỏng
                   thì hàng đó vẫn vẽ ra được, và im lặng về lý do là để người dùng
                   tưởng tài khoản của mình biến mất. -->
              <p v-if="profileNote || !shownProfiles.length" class="ihint ictx-note">
                {{ profileNote || t('infra.bar.noMatch', { q: profileQuery }) }}
              </p>
            </div>
          </div>

          <!-- Region. Mục đầu là "Theo profile" — cùng nhãn với ô region của chip
               trong phiên, vì cùng một giá trị: `run.ts` chỉ chèn `--region` khi
               `ctx.region` có giá trị, nên để trống nghĩa là không truyền cờ và
               `aws` tự lấy region từ `~/.aws/config` của profile. -->
          <div class="ictx-sec" role="group" :aria-label="t('infra.region.label')">
            <div class="ilbl">{{ t('infra.region.label') }}</div>
            <label class="srch ictx-srch">
              <Icon name="search" />
              <input
                ref="regionSearchEl"
                v-model="regionQuery"
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="ictx-list-region"
                :aria-expanded="true"
                :aria-activedescendant="activeId"
                :placeholder="t('infra.bar.searchRegion')"
                @keydown="onKeydown"
              />
            </label>
            <div
              id="ictx-list-region"
              ref="regionListEl"
              class="ictx-list"
              role="listbox"
              :aria-label="t('infra.region.label')"
            >
              <div
                v-for="(r, i) in shownRegions"
                :id="`ictx-o-${shownProfiles.length + i}`"
                :key="r.value"
                class="ictx-opt"
                :class="{ on: r.value === region, 'ictx-cur': active === shownProfiles.length + i }"
                role="option"
                :aria-selected="r.value === region"
                @mouseenter="setActive(shownProfiles.length + i)"
                @click="pickRegion(r.value)"
              >
                <span class="ictx-opt-l">{{ r.label }}</span>
                <Icon v-if="r.value === region" name="check" class="ictx-tick" />
              </div>
              <p v-if="!shownRegions.length" class="ihint ictx-note">
                {{ t('infra.bar.noMatch', { q: regionQuery }) }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </span>
  </div>
</template>

<script setup lang="ts">
// Ô chọn NGỮ CẢNH AWS cho cả trang `/infra` — hai trường mà mọi lời gọi CLI dùng:
// profile (tài khoản) và region. Component này chỉ BIND: nó không tự ghi store,
// cũng không tự gọi RPC — trang truyền giá trị đang ghim xuống và nhận tín hiệu
// đổi lên (`useInfraPage` giữ luật "đổi profile thì accountId cũ phải bị xoá",
// một luật an toàn chỉ được nằm ở một chỗ).
//
// `cluster` của spec chưa có mặt: nó là ngữ cảnh Kubernetes và đã có ô riêng ở
// tab Kubernetes (dùng chung state qua `settings.infra`). Thêm một ô cluster nữa
// ở đây là bản sao thứ hai của cùng một lựa chọn.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEscToClose } from '~/composables/useEscToClose'
import { AWS_REGIONS } from '~/utils/aws-regions'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { AwsProfile } from '~/types'

const props = defineProps<{
  /** Danh sách GỐC từ `~/.aws` (chưa lọc theo ô tìm của tab Tài khoản). */
  profiles: readonly AwsProfile[]
  /** Profile đang ghim toàn app — `''` nghĩa là chưa chọn. */
  profile: string
  /** Region đang ghim toàn app. */
  region: string
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'select-profile', name: string): void
  (e: 'select-region', region: string): void
  /** "Quản lý profile…" — nhảy sang tab Tài khoản (route của profile manager). */
  (e: 'manage'): void
}>()

const { t } = useI18n()

const open = ref(false)
function close(): void {
  open.value = false
}
// Đóng bằng Esc từ bất kỳ đâu (ô tìm, backdrop, hay focus đang ở trong menu).
useEscToClose(open, close)

/**
 * Giá trị đang GHIM phải luôn có mặt trong danh sách chọn (cùng luật với
 * `withPinned` ở `InfraKubernetes.vue`): lượt đọc `~/.aws` có thể hỏng, hoặc bị
 * quyền hạn chế, và khi đó ô chọn hiện placeholder trong khi app VẪN đang chạy
 * lệnh bằng profile đó — người dùng đọc được một ngữ cảnh khác hẳn sự thật.
 */
function withPinned(options: AppSelectOption[], pinned: string): AppSelectOption[] {
  if (!pinned || options.some((o) => o.value === pinned)) return options
  return [{ label: pinned, value: pinned }, ...options]
}

/** Giá trị đặc biệt của mục "Quản lý profile…" — không phải tên profile nào. */
const MANAGE = '\u0000manage'

const profileOptions = computed<AppSelectOption[]>(() => [
  ...withPinned(
    props.profiles.map((p) => ({ label: p.name, value: p.name })),
    props.profile,
  ),
  // Luôn có mặt — kể cả khi danh sách rỗng: đó chính là lúc cần nó nhất, và nó là
  // đường duy nhất từ tab Dịch vụ sang chỗ thêm profile mà không phải đoán tab.
  { label: t('infra.bar.manage'), value: MANAGE },
])

/**
 * Region của ngữ cảnh + region khai trong các profile + danh sách region chuẩn.
 * Ghép từ ba nguồn thay vì chỉ danh sách cứng: một profile trỏ tới region chưa
 * có trong danh sách (GovCloud/ISO, hoặc AWS vừa mở) vẫn phải chọn lại được.
 *
 * Mục `''` là "Theo profile" và đứng ĐẦU: đó là mặc định, và là đường quay về sau
 * khi đã ghi đè. Đường ghi đè vẫn phải có vì ba ca mà "theo profile" không trả lời
 * được: profile không khai `region` (profile SSO rất hay thiếu — `toProfile()`
 * trong `aws/profiles.ts` chỉ đọc khoá khi nó có trong ini), dịch vụ global
 * (IAM/Route53/CloudFront không thuộc region nào; ACM cho CloudFront bắt buộc
 * `us-east-1`), và đổi tạm mà không phải sửa `~/.aws/config` (AWOG không ghi file
 * đó).
 */
const regionOptions = computed<AppSelectOption[]>(() => {
  const seen = new Set<string>()
  const out: AppSelectOption[] = [{ label: t('infra.region.follow'), value: '' }]
  const push = (value: string | undefined): void => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ label: value, value })
  }
  push(props.region)
  for (const p of props.profiles) push(p.region)
  for (const r of AWS_REGIONS) push(r)
  return out
})

/** Nhãn trên trigger: cả hai nửa của ngữ cảnh, không nửa nào được vắng. */
const profileLabel = computed(() => props.profile || t('infra.profile.none'))
const regionLabel = computed(() => props.region || t('infra.region.follow'))

/** Vì sao danh sách profile trống — ba nguyên nhân, ba câu. */
const profileNote = computed(() => {
  if (props.loading) return t('infra.profile.loading')
  if (props.error) return t('infra.profile.failed')
  if (!props.profiles.length) return t('infra.profile.empty')
  return ''
})

// ── Hai ô tìm (mỗi mục một ô) + điều hướng bằng bàn phím ────────────────────
//
// Lọc là literal substring trên nhãn, không regex và không fuzzy: người dùng gõ
// `ap-s` để tìm `ap-southeast-1` thì đó là ý định của họ, còn fuzzy match sẽ trả
// về một danh sách mà không ai đoán được vì sao có những mục kia. Bỏ khác biệt
// hoa/thường và chuẩn hoá NFC (tên profile có thể chứa dấu tiếng Việt ở dạng tổ
// hợp).
const profileQuery = ref('')
const regionQuery = ref('')
const norm = (s: string): string => s.normalize('NFC').toLowerCase()
function matches(label: string, query: string): boolean {
  const q = norm(query.trim())
  return !q || norm(label).includes(q)
}

const shownProfiles = computed(() =>
  profileOptions.value.filter((o) => matches(o.label, profileQuery.value)),
)
const shownRegions = computed(() =>
  regionOptions.value.filter((o) => matches(o.label, regionQuery.value)),
)

type Pick = { kind: 'profile' | 'region'; value: string; label: string }
/** Danh sách PHẲNG đúng theo thứ tự đang vẽ — chỉ số của nó là thứ phím ↑↓ đi qua. */
const picks = computed<Pick[]>(() => [
  ...shownProfiles.value.map((o) => ({ kind: 'profile' as const, value: o.value, label: o.label })),
  ...shownRegions.value.map((o) => ({ kind: 'region' as const, value: o.value, label: o.label })),
])
const active = ref(0)
const activeId = computed(() => (picks.value.length ? `ictx-o-${active.value}` : undefined))
const profileSearchEl = useTemplateRef<HTMLInputElement>('profileSearchEl')
const regionSearchEl = useTemplateRef<HTMLInputElement>('regionSearchEl')
const profileListEl = useTemplateRef<HTMLElement>('profileListEl')
const regionListEl = useTemplateRef<HTMLElement>('regionListEl')

// Mở ra là gõ được ngay, và trỏ vào ô của Profile: đổi tài khoản là việc hay làm
// hơn đổi region, và người mở menu này gần như luôn đã biết mình tìm gì.
watch(open, async (isOpen) => {
  if (!isOpen) return
  profileQuery.value = ''
  regionQuery.value = ''
  active.value = 0
  await nextTick()
  resetScroll()
  profileSearchEl.value?.focus()
})

// Về đầu danh sách mỗi lần lọc: giữ vị trí cuộn của lần tìm TRƯỚC là để hàng đầu
// tiên — hàng đang được chọn — nằm khuất trên mép khung.
watch([profileQuery, regionQuery], async () => {
  active.value = 0
  await nextTick()
  resetScroll()
})

function resetScroll(): void {
  if (profileListEl.value) profileListEl.value.scrollTop = 0
  if (regionListEl.value) regionListEl.value.scrollTop = 0
}

/**
 * Đưa một hàng thành hàng ĐANG CHỌN.
 *
 * `scroll` tách hover khỏi bàn phím, và đây là cả một bug chứ không phải chi tiết:
 * cuộn theo con trỏ chuột thì hàng mới trôi vào dưới đúng chỗ đang trỏ, lại sinh
 * một `mouseenter`, lại cuộn — vòng lặp đó nhìn ra thành "nháy hover" (2026-09-14).
 * Chuột thì chỉ đổi hàng đang chọn; chỉ bàn phím mới được cuộn, vì người gõ ↑↓
 * không có con trỏ nào để thấy hàng vừa đi qua.
 */
function setActive(index: number, scroll = false): void {
  active.value = index
  if (scroll) scrollActiveIntoView()
}

function scrollActiveIntoView(): void {
  const inProfile = active.value < shownProfiles.value.length
  const list = inProfile ? profileListEl.value : regionListEl.value
  list?.querySelector('.ictx-opt.ictx-cur')?.scrollIntoView({ block: 'nearest' })
}

async function move(delta: number): Promise<void> {
  const n = picks.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  await nextTick()
  scrollActiveIntoView()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    void move(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    void move(-1)
    return
  }
  if (e.key === 'Enter') {
    const pick = picks.value[active.value]
    if (!pick) return
    e.preventDefault()
    run(pick)
  }
}

function run(pick: Pick): void {
  if (pick.kind === 'profile') pickProfile(pick.value)
  else pickRegion(pick.value)
}

function pickProfile(value: string): void {
  close()
  if (value === MANAGE) {
    emit('manage')
    return
  }
  emit('select-profile', value)
}

function pickRegion(value: string): void {
  close()
  emit('select-region', value)
}
</script>

<style scoped>
/* Một hàng, cao bằng hàng tab. Nhãn đứng trước để trigger không phải tự nói nó
   là gì — giá trị bên trong ("dev-sandbox · Theo profile") đọc được ngay. */
.ictx {
  display: flex;
  align-items: center;
  gap: 6px;
  /* Đẩy cả cụm sang phải hàng tab, không để nó chen vào giữa các tab. */
  margin-left: auto;
}

.ictx-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Cùng vocabulary với `.aseltrigger` mà hai ô chọn cũ dùng: cao bằng nhau, cùng
   nền `--bgInput`. Đổi sang dáng chip (`.ctxchip`) sẽ làm thanh này lệch hàng tab. */
.ictx-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  border: 1px solid var(--border);
  background: var(--bgInput);
  border-radius: var(--r-sm);
  padding: 7px 10px;
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  cursor: pointer;
}
.ictx-btn:hover {
  border-color: var(--borderStrong);
}
.ictx-btn.on {
  border-color: var(--accentBorder);
}

.ictx-ic,
.ictx-chev {
  flex: 0 0 auto;
  color: var(--textFaint);
}
.ictx-chev.open {
  transform: rotate(180deg);
}

/* Giá trị: tên profile tự cắt (nó dài nhất và hay đổi), region thì không — mã
   region ngắn và bị cắt thì mất luôn thông tin. */
.ictx-val {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ictx-who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ictx-dot,
.ictx-where {
  flex: 0 0 auto;
  color: var(--textDim);
}

/* Menu neo PHẢI: thanh này nằm ở cuối hàng tab, neo trái thì menu 320px tràn ra
   ngoài cửa sổ. Trần chiều cao để hai mục + hai ô tìm luôn nằm gọn trong màn. */
.ictx-pop {
  left: auto;
  right: 0;
  width: 320px;
  max-height: min(70vh, 460px);
  overflow-y: auto;
}

/* Hai mục là hai khối RIÊNG, mỗi khối có ô tìm của nó. Vạch ngăn thay cho
   `.ictx-sep` cũ: hai thứ khác loại (tài khoản vs vị trí), và lẫn chúng vào một
   danh sách phẳng là để người dùng đọc nhầm một mã region thành một tên profile. */
.ictx-sec + .ictx-sec {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.ictx-srch {
  flex: 0 0 auto;
}

/* Danh sách cuộn TRONG khi ô tìm đứng yên: gõ thêm một ký tự mà ô tìm trôi mất
   thì lần gõ tiếp theo là một cú nhắm chuột. Trần 140px để danh sách profile ngắn
   không chiếm chỗ của danh sách region (và ngược lại). */
.ictx-list {
  max-height: 140px;
  overflow-y: auto;
  margin-top: 6px;
}

.ictx-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
/* Tên lớp KHÔNG được là `.cursor`: đó là class dùng chung của con trỏ nhấp nháy
   trong composer (`prototype.css` — `width:7px; height:15px; animation: bl 1s
   steps(2) infinite`), và class toàn cục thì vẫn áp lên phần tử của component
   scoped. Bản trước dùng `.cursor` nên hàng đang chọn bị ép thành một ô 7×15px
   nhấp nháy — đúng cái "nháy hover" và "lỗi hiển thị" của 2026-09-14. */
.ictx-opt.ictx-cur {
  background: var(--bgHover);
}
.ictx-opt.on {
  color: var(--accent);
}
.ictx-opt-l {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ictx-tick {
  flex: 0 0 auto;
  color: var(--accent);
}

.ictx-note {
  margin: 4px 0 0;
  padding: 0 8px;
}
</style>
