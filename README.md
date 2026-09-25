# EHub

> Tên cũ: **AdsHub**. Các định danh nội bộ vẫn giữ `adshub` (thư mục `/opt/adshub` và CSDL trên máy chủ, cookie, biến CSS, header cập nhật) để máy chủ đã cài vẫn nhận bản cập nhật và tuỳ chọn đã lưu không mất.

Trung tâm API cho dữ liệu quảng cáo và đơn hàng. Kết nối nhiều nguồn (TikTok Ads,
Sapo, và về sau Meta Ads, Shopee…), xem toàn bộ endpoint ở một nơi, gọi thử và
lấy dữ liệu JSON — làm nền cho các lớp tính toán, báo cáo phía sau.

---

## Chạy dự án

```bash
npm install
npm run dev
```

Mở http://localhost:3000 và đăng ký tài khoản. **Tài khoản đầu tiên tự động trở
thành quản trị viên hệ thống.**

`npm run dev` làm tuần tự trong một lệnh:

1. Tạo `.env.local` với secret sinh mới, nếu chưa có
2. Sinh migration SQL từ schema, nếu `drizzle/` còn trống
3. Khởi tạo và migrate cơ sở dữ liệu
4. Đóng database rồi mới khởi động Next.js (không được có hai tiến trình ghi)

Không cần Docker, không cần cài Postgres, không cần dịch vụ nền nào.

### Yêu cầu

Node.js 20.9+ (đã kiểm thử trên 22.14). Không có yêu cầu nào khác.

---

## Cơ sở dữ liệu

| | Development | Production |
|---|---|---|
| Driver | PGlite — Postgres 16 biên dịch WASM, chạy trong tiến trình Node | node-postgres |
| Lưu ở | `./.data/pgdata` | Postgres server thật |
| Cấu hình | `DATABASE_URL` để trống | `DATABASE_URL=postgresql://…` |

Cả hai dùng **cùng một schema và cùng bộ migration** trong `drizzle/`. Lên
production chỉ là đổi biến môi trường, không sửa dòng code nào.

### Một tiến trình ghi, và tại sao điều đó quan trọng

PGlite **không** cưỡng chế single-writer. Đã đo trực tiếp:

- Nó ghi pid giả `-42` vào `postmaster.pid`, nên file đó không cho biết có gì
  đang chạy hay không
- `postmaster.pid` còn sót lại **không** chặn lần mở sau
- **Hai instance mở cùng một thư mục đều thành công, không cảnh báo gì**

Điểm thứ ba là nguy hiểm: hai tiến trình ghi song song làm hỏng cluster trong
im lặng, và thiệt hại chỉ lộ ra sau đó dưới dạng `RuntimeError: Aborted()` từ
WASM — **không thể sửa tại chỗ**.

Vì thư viện không chặn, dự án tự chặn: `npm run dev` ghi pid thật vào
`.data/dev.lock` và giữ suốt thời gian Next chạy. Mọi script mở database đều
kiểm tra file đó trước và từ chối nếu dev server đang giữ.

```
$ npm run db:migrate          # trong khi dev đang chạy
✗ The dev server (pid 16764) currently has the embedded database open.
```

### Snapshot và phục hồi

Vì cluster hỏng không sửa được tại chỗ, và nó chứa credential bạn tự tay nhập
(không lấy lại được từ đâu khác), dự án chụp snapshot định kỳ:

| Lệnh | Việc nó làm |
|---|---|
| `npm run db:snapshot` | Chụp ngay một bản `.data/snapshots/<thời-điểm>.tar.gz` |
| `npm run db:restore` | Phục hồi bản mới nhất |
| `npm run db:restore <tên>` | Phục hồi một bản cụ thể |

`npm run dev` tự chụp nếu bản mới nhất đã quá 6 giờ — đo được khoảng **1 giây
và 4 MB** cho một project nhỏ, nên đủ rẻ để làm thường xuyên. Giữ 5 bản gần
nhất.

Khi phục hồi, thư mục hiện tại được **đổi tên giữ lại** (`pgdata.before-restore-*`)
chứ không xoá — nếu chọn sai snapshot thì bản kia vẫn còn.

### Lệnh

| Lệnh | Việc nó làm |
|---|---|
| `npm run dev` | Database + backend + frontend, một lệnh |
| `npm run build` / `npm start` | Build và chạy production (tự migrate trước khi build) |
| `npm run check` | Typecheck + kiểm tra hợp đồng plugin (offline, an toàn cho CI) |
| `npm run check:plugins` | 106 assertion trên toàn bộ plugin đã đăng ký |
| `npm run check:paths` | 33 assertion chống SSRF cho đường dẫn tự do (offline) |
| `npm run check:connectors` | Kiểm thử tích hợp: mở DB và gọi nhà cung cấp thật. **Cần tắt dev server** |
| `npm run verify:live` | Kiểm chứng một kết nối **bằng credential thật** của bạn, đi qua đúng code của ứng dụng. Nhận credential qua biến môi trường, không ghi vào file nào |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Sinh migration SQL sau khi sửa schema |
| `npm run db:migrate` | Áp migration |
| `npm run db:snapshot` / `db:restore` | Sao lưu và phục hồi database nhúng |
| `npm run db:reset` | Xoá database nhúng. **Từ chối chạy nếu đang có tài khoản** — thêm `-- --force` để ghi đè. Luôn từ chối nếu `DATABASE_URL` trỏ Postgres thật |

---

## Kiến trúc

```
src/
├─ core/                     Hạ tầng — không biết gì về nhà cung cấp cụ thể
│  ├─ db/         schema Drizzle + chọn driver (PGlite ⇄ Postgres)
│  ├─ auth/       better-auth, RBAC theo project, helper session
│  ├─ crypto/     mã hoá phong bì AES-256-GCM cho credential
│  ├─ plugins/    HỢP ĐỒNG PLUGIN: types, registry, http, params, redact, execute
│  └─ utils/      id, slug tiếng Việt, suy luận schema từ dữ liệu
│
├─ plugins/                  Mỗi nhà cung cấp là một thư mục độc lập
│  ├─ tiktok-ads/    index.ts + endpoints.ts
│  ├─ tiktok-shop/   Partner API: ký request, tự làm mới token
│  ├─ sapo/          index.ts + endpoints.ts
│  └─ index.ts       ← ĐIỂM MỞ RỘNG: danh sách đăng ký
│
├─ modules/                  Các trang của project, mỗi module một thư mục
│  ├─ overview/      Tổng quan (live)
│  ├─ bookings/      Dữ liệu booking: chuẩn trường, chiến dịch, nhập tay/hàng loạt, Excel/CSV
│  ├─ analytics/     KHUNG CHUNG của 4 báo cáo: kỳ, nguồn, trang, thẻ, bộ đọc dữ liệu
│  ├─ booking-koc/   Booking & KOC
│  ├─ video-gmv/     Video & GMV sản phẩm
│  ├─ cost-roi/      Chi phí & ROI
│  ├─ order-cancel/  Đơn & huỷ
│  ├─ index.ts       ← danh sách module (menu)
│  └─ reports.ts     ← server: module id → hàm dựng báo cáo
│
├─ features/                 Logic nghiệp vụ (server actions + queries)
│  ├─ projects/    project, thành viên, lời mời
│  ├─ connections/ CRUD kết nối, kiểm tra kết nối
│  └─ datasets/    thu nhận và đồng bộ dữ liệu
│
├─ app/                      Route Next.js App Router
│  ├─ (auth)/      đăng nhập, đăng ký
│  ├─ (app)/       vỏ ứng dụng sau đăng nhập
│  │  ├─ projects/                 danh sách + tạo project
│  │  ├─ projects/[projectId]/     tổng quan, hub, datasets, logs, settings
│  │  └─ invite/[token]/           nhận lời mời
│  └─ api/         better-auth handler, API Hub execute
│
├─ components/               UI dùng chung + JSON viewer
└─ i18n/                     next-intl, locale lưu trong cookie
```

### Nguyên tắc phân tầng

`core/` không bao giờ import `plugins/*` trực tiếp — mọi thứ đi qua
`core/plugins/registry`. Nhờ vậy một plugin lỗi hoặc bị xoá không thể làm sập
phần còn lại của ứng dụng, và thêm nhà cung cấp mới không phải sửa file core nào.

### Luồng một request trong API Hub

```
Người dùng bấm "Gọi API"
  → POST /api/hub/execute
  → assertCapability(projectId, 'hub:execute')       ai được gọi
  → executeEndpoint()
      ├─ giải mã credential (chỉ ở đây, không nơi nào khác)
      ├─ plugin.resolveParams()   điền giá trị từ kết nối
      ├─ validateParams()         chặn request thiếu tham số
      ├─ plugin.buildRequest()    dựng HTTP request thật
      ├─ sendRequest()            timeout, backoff theo Retry-After
      ├─ plugin.parseError()      bắt lỗi nằm trong body HTTP 200
      ├─ buildRequestEcho()       che secret trước khi trả về/ghi log
      └─ ghi api_call_logs
  → JSON: response, records, schema suy luận, request đã che
```

---

## Giao diện

Xây trên [Material UI](https://mui.com) v9. Ngôn ngữ thiết kế gồm bốn quy tắc:

| Quy tắc | Thể hiện |
|---|---|
| **Xanh jade là điểm nhấn duy nhất** | Header, tiêu đề mục, mọi trạng thái tích cực. `#1BA36B` sáng ↔ `#3FD397` tối |
| **Phẳng** | Card **không viền, không đổ bóng** — tách khỏi nền chỉ bằng sắc độ. Input là khối màu nhạt, viền chỉ hiện khi hover/focus |
| **Mờ** | Card hơi trong suốt + `backdrop-filter`, đặt trên một lớp loang pastel — màu phía sau thấm qua thay vì dừng ở mép card |
| **Bo lớn + nét đứt** | Card 18px, dialog 22px; mọi đường phân cách bên trong card là **gạch nét đứt** |

Hai nửa của hiệu ứng "mờ" phải đi cùng nhau: `AmbientBackground` cung cấp vệt
loang, `MuiPaper` cung cấp mặt kính. Thiếu vệt loang thì trong suốt không có gì
để lộ ra và card chỉ trông bạc màu.

Vệt loang dựng bằng radial-gradient xếp lớp, **không dùng `filter: blur()`** —
gradient vốn đã mượt, còn blur sẽ buộc trình duyệt composite lại cả trang mỗi
lần cuộn.

### Sáng / tối

Dùng cơ chế **CSS theme variables** của MUI (`cssVariables` + `colorSchemes`)
thay cho cách đổi qua lại hai theme object. Mọi màu thành CSS custom property,
nên cả hai bảng màu nằm sẵn trong stylesheet — chuyển chế độ chỉ là đổi một
attribute trên `<html>`, không re-render React, và **không nháy sai màu ở lần vẽ
đầu** kể cả với trang render từ server.

```css
:root, [data-mui-color-scheme="light"] { --mui-palette-primary-main: #1BA36B; … }
[data-mui-color-scheme="dark"]         { --mui-palette-primary-main: #3FD397; … }
```

| Thành phần | Vai trò |
|---|---|
| `src/theme.ts` | Nguồn duy nhất: hai bảng màu, typography, `defaultProps` từng component |
| `InitColorSchemeScript` | Chạy trước khi React hydrate, gắn attribute từ lựa chọn đã lưu |
| `AppRouterCacheProvider` | Emotion SSR cho App Router, bật `@layer mui` để CSS của bạn luôn thắng |
| `ThemeToggle` | Sáng / Tối / **Theo hệ thống**, lưu trong localStorage |

Ngoài palette còn một nhóm token riêng khai báo theo từng scheme
(`--adshub-surface-glass`, `--adshub-surface-inset`, `--adshub-dashed`,
`--adshub-soft-tint`, `--adshub-blob-*`). Chúng là CSS variable thuần chứ không
mở rộng palette: chỉ được đọc từ `sx`, nên cách này vẫn đổi theo theme mà không
phải bảo trì một khai báo module.

Chế độ mặc định là *theo hệ thống*. Vì `mode` chỉ tồn tại ở phía browser, nút
chuyển hiển thị placeholder cùng kích thước ở lần render đầu để tránh lệch
hydration và nhảy layout.

### Khả năng đọc

Trong suốt dễ làm hỏng độ tương phản chữ, nên có ba lớp bảo vệ:

- Độ mờ của card giữ ở mức cao (82% sáng / 72% tối), và các vệt loang rất nhạt
- `@media (prefers-reduced-transparency: reduce)` → mặt kính thành đục hoàn toàn
- `@supports not (backdrop-filter)` → nâng độ mờ lên 96%

Alert khai báo lại một mức tint 13% cho cả bốn severity, vì nền chuẩn của MUI
được pha theo từng màu và ra độ đậm lệch nhau — đứng cạnh card phẳng sẽ trông
không đồng bộ.

### Bố cục

`AppBar` xanh đặc dính trên cùng (hai đĩa sáng mờ vẽ bằng gradient, nên AppBar
vẫn là một node duy nhất). `Drawer` cố định trên desktop, viền phải nét đứt,
nền trong suốt để vệt loang chạy xuyên qua. Trên mobile sidebar thu thành `Tabs`
cuộn ngang — không cần state đóng/mở, và API Hub giữ được toàn bộ chiều ngang.

Font Inter qua `next/font`, **có subset `vietnamese`** — thiếu subset này thì
mọi chữ có dấu rơi về font khác và trông như bị chắp vá.

### Hai cái bẫy khi trộn MUI với Server Component

Component của MUI đều là Client Component, nên Server Component **không thể**
truyền hàm cho chúng. Hai chỗ hay vướng, đã xử lý sẵn ở tầng theme:

1. **`component={Link}`** — truyền component Next Link từ server sẽ lỗi
   *"Functions cannot be passed directly to Client Components"*. Theme đã đặt
   `MuiButtonBase.defaultProps.LinkComponent = NextLink`, nên mọi thứ hình dạng
   nút (Button, IconButton, CardActionArea, ListItemButton, Tab) chỉ cần `href`.
   Với link dạng chữ, dùng `AppLink` trong `src/components/ui/`.
2. **`sx` dạng callback** — ví dụ `sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}`
   cũng là một hàm. Những giá trị cần đọc theme phải đặt trong `styleOverrides`
   của theme, không đặt trong `sx` của trang server.

Client Component thì không bị hạn chế này — `component={Link}` dùng bình thường.

### Ghi chú cho MUI v9

v9 bỏ các prop và class key kiểu cũ; nếu bạn tham khảo tài liệu v5/v6 sẽ gặp:

- `inputProps` → `slotProps={{ htmlInput: … }}`
- `primaryTypographyProps` → `slotProps={{ primary: … }}`
- `titleTypographyProps` → `slotProps={{ title: … }}`
- Không còn class key ghép (`filledPrimary`, `standardSuccess`). Muốn style một
  tổ hợp variant × color thì dùng `variants: [{ props: { … }, style: { … } }]`

---

## Thêm một plugin mới

Ví dụ thêm Meta Ads. Toàn bộ công việc nằm trong một thư mục mới cộng **một dòng**
ở registry.

**1.** `src/plugins/meta-ads/endpoints.ts` — danh mục endpoint, là dữ liệu thuần:

```ts
import type { EndpointSpec } from '@/core/plugins/types'

export const metaEndpoints: EndpointSpec[] = [
  {
    id: 'campaigns',
    group: 'Campaign',
    name: { vi: 'Danh sách chiến dịch', en: 'List campaigns' },
    method: 'GET',
    path: '/v21.0/act_{account_id}/campaigns',
    resultPath: 'data',
    idField: 'id',
    pagination: { style: 'cursor', cursorParam: 'after', nextCursorPath: 'paging.cursors.after' },
    params: [
      {
        key: 'account_id',
        label: { vi: 'Ad Account ID', en: 'Ad Account ID' },
        in: 'path',
        type: 'string',
        required: true,
        satisfiedByConnection: true,   // resolveParams sẽ điền từ kết nối
      },
      {
        key: 'fields',
        label: { vi: 'Trường trả về', en: 'Fields' },
        in: 'query',
        type: 'string[]',
        defaultValue: ['id', 'name', 'status', 'objective'],
      },
    ],
  },
]
```

**2.** `src/plugins/meta-ads/index.ts` — khai báo cách xác thực và dựng request:

```ts
import { buildQueryString } from '@/core/plugins/http'
import { applyPathParams, partitionParams } from '@/core/plugins/params'
import type { ConnectorPlugin } from '@/core/plugins/types'
import { metaEndpoints } from './endpoints'

export const metaAdsPlugin: ConnectorPlugin = {
  id: 'meta-ads',
  name: 'Meta Ads',
  description: { vi: '…', en: '…' },
  version: '1.0.0',
  category: 'ads',
  color: '#0866FF',
  auth: {
    type: 'api_key',
    instructions: { vi: '…', en: '…' },
    fields: [
      { key: 'accessToken', label: { vi: 'Access Token', en: 'Access Token' },
        type: 'password', secret: true, required: true },
      { key: 'adAccountId', label: { vi: 'Ad Account ID', en: 'Ad Account ID' },
        type: 'text' },
    ],
  },
  endpoints: metaEndpoints,

  resolveParams: ({ params, context }) => ({
    ...params,
    account_id: params.account_id || context.credentials.adAccountId,
  }),

  buildRequest: ({ endpoint, params, context }) => {
    const { query, path } = partitionParams(endpoint, params)
    const url = `https://graph.facebook.com${applyPathParams(endpoint.path, path)}`
    return {
      url: `${url}${buildQueryString(query)}`,
      method: endpoint.method,
      headers: { Authorization: `Bearer ${context.credentials.accessToken}` },
    }
  },

  testConnection: async (context) => { /* gọi endpoint nhẹ nhất */ },
}

export default metaAdsPlugin
```

**3.** `src/plugins/index.ts` — đăng ký:

```diff
+ import { metaAdsPlugin } from './meta-ads'

- export const plugins: ConnectorPlugin[] = [tiktokAdsPlugin, sapoPlugin]
+ export const plugins: ConnectorPlugin[] = [tiktokAdsPlugin, sapoPlugin, metaAdsPlugin]
```

**4.** `npm run check:plugins`

Xong. Form nhập credential, danh mục endpoint trong API Hub, form tham số, thực
thi request, ghi log, thu nhận dataset — tất cả tự động hoạt động vì đều đọc qua
hợp đồng `ConnectorPlugin`.

### Những gì `check:plugins` bảo đảm

Kiến trúc plugin chỉ có giá trị nếu thêm nhà cung cấp mới *không thể* làm hỏng
nhà cung cấp cũ. Script này ép buộc điều đó thay vì chỉ ghi trong tài liệu:

- id plugin và id endpoint là duy nhất, an toàn khi đưa vào URL
- mọi tên và mô tả đều có cả hai ngôn ngữ
- mọi field có hình dạng credential đều được đánh dấu `secret`
- `buildRequest` trả về URL https tuyệt đối, có xác thực, không còn placeholder
- **không secret nào lọt vào bản echo hiển thị trên UI hoặc ghi vào log**
- mọi param `satisfiedByConnection` thực sự được `resolveParams` điền
- phong bì mã hoá: round-trip đúng, IV mới mỗi lần, từ chối dữ liệu bị sửa
- mọi `hint` chẩn đoán connector khai báo đều có bản dịch ở **cả hai** ngôn ngữ,
  đúng tiền tố plugin, và hai bundle vi/en không lệch key — một hint không dịch
  sẽ hiện ra trống đúng lúc người dùng đang bí
- action của connector: id duy nhất, nhãn có hai ngôn ngữ, input mang credential
  đều đánh dấu `secret`, và summary gửi sang client không mang theo function nào

---

### Công cụ chẩn đoán do connector khai báo

Lỗi credential luôn mang tính đặc thù nhà cung cấp, và **chỉ nhà cung cấp trả
lời được** — câu "App ID/Secret này có thật không?" không có dạng tổng quát.
Nên connector tự khai báo công cụ sửa lỗi của mình, và trang Cài đặt render bất
kỳ action nào nó tìm thấy mà không biết gì về OAuth của TikTok.

```ts
actions: [
  {
    id: 'diagnose',
    label: { vi: 'Chẩn đoán từng thông tin', en: 'Diagnose each credential' },
    mutatesCredentials: false,          // chỉ cần quyền connection:view
    async run({ context }) {
      return { ok, message, hint, findings }   // findings = checklist từng dòng
    },
  },
]
```

Action dành cho việc **kiểm tra**, không phải cho việc thiết lập. Nếu một
credential cần được *lấy về* (đổi `auth_code` sang token chẳng hạn) thì đó là
việc của `resolveCredentials` — xem mục dưới. Ban đầu tôi làm nó thành một
action riêng, và đó là một bước quá nhiều: người dùng phải lưu kết nối trước rồi
đi tìm nút, mà chính ở bước đó `auth_code` bị dán vào ô Access Token.

Quyền lấy từ chính khai báo của action: `mutatesCredentials: false` → ai xem
được kết nối đều chạy được; `true` → cần đúng quyền sửa credential. Quy tắc nằm
cùng action thay vì trong một danh sách ở tầng core rồi lệch dần.

`core/plugins/run-action.ts` là **nơi duy nhất** action chạm được credential đã
lưu và là nơi duy nhất được ghi credential mới. Hai bất biến ở đó:

- Input của người dùng và credential kết quả **không bao giờ** vào audit trail —
  `auth_code` và access token đều là bearer secret, log là chỗ tệ nhất để chúng
  tích tụ. Chỉ tên field được ghi.
- `credentialUpdates` được **gộp**, không thay thế cả bag — action phát hành
  token mới không được âm thầm làm mất App ID nằm cạnh.

`npm run check:connectors` kiểm chứng đúng những điều đó trên database thật:
token không xuất hiện trong payload trả về client, không trong audit trail,
không ở dạng plaintext trong cột, và App ID/Secret cũ vẫn còn sau khi gộp.

### Một form, hai cách nhập: `resolveCredentials`

Có nhà cung cấp mà credential lâu dài phải **lấy về** chứ không phải nhập vào:
TikTok phát hành access token từ một `auth_code` dùng một lần. Thay vì bắt
người dùng lưu trước rồi chạy một công cụ riêng, connector khai báo
`resolveCredentials` — chạy đúng một lần khi lưu, trước khi mã hoá:

```ts
resolveCredentials: async ({ credentials, previous }) => {
  const { appId, appSecret, authCode, accessToken } = credentials

  const stored = { ...credentials }
  delete stored.authCode            // transient: không bao giờ lưu

  if (!authCode) {
    return accessToken
      ? { ok: true, credentials: stored }
      : { ok: false, credentials: stored, hint: 'tiktokNeedsCodeOrToken' }
  }

  const issued = await exchangeAuthCode(appId, appSecret, authCode)
  return { ok: true, credentials: { ...stored, accessToken: issued }, hint: 'tiktokExchangeOk' }
}
```

Field `auth_code` khai báo `transient: true`. Ba hệ quả, tất cả đều được
kiểm tra tự động:

- **Không bao giờ được lưu.** Tầng `features/connections` tự strip mọi field
  transient khỏi bag trước khi mã hoá, nên một connector quên xoá cũng không
  để lại secret đã tiêu.
- **Không bao giờ được giữ khi sửa.** Field secret để trống thường có nghĩa
  "giữ giá trị cũ"; với transient thì không có gì để giữ.
- **Không bao giờ hiện là "đã lưu".** Form luôn render nó rỗng, thay vì nói
  rằng đang giữ một giá trị.

`ok: false` chặn việc lưu và hiện `hint` ngay trên form — đó là cách câu
"bạn chưa điền cái nào trong hai thứ tôi nhận" được báo ra.

---

### Chẩn đoán TikTok: mã lỗi nào nghĩa là gì

Xác định bằng cách dò API thật với từng tổ hợp credential sai:

| Gửi lên | Mã trả về |
|---|---|
| App ID/Secret **rác** + token rác | `40105` |
| Không gửi App ID/Secret + token rác | `40105` |
| App ID/Secret rác + token **rỗng** | `40104` |
| App ID/Secret sai (endpoint đổi token) | `40002` |

Phát hiện then chốt: **TikTok kiểm tra token TRƯỚC app credentials.** `40105`
xuất hiện kể cả khi App ID/Secret là rác hoàn toàn — nên ai nhận `40105` mà đi
soi App ID là đang tìm sai chỗ. Đó chính là bước sai mà bảng map này ngăn lại.

Endpoint `/oauth2/access_token/` dùng `40002` cho **cả** "app_id/secret sai"
**lẫn** "thiếu field", chỉ `message` phân biệt được. Đó cũng là thứ cho phép
kiểm tra App ID/Secret **độc lập với token**: gửi một `auth_code` cố tình sai
rồi đọc xem lời phàn nàn nhắm vào nửa nào.

Còn một mã nữa, và là mã hay gặp nhất: `40110` — *"Auth_code is used，please
re-authorize."* Mỗi `auth_code` dùng được đúng một lần, nên ai bấm lưu lại
hoặc reload URL callback đều rơi vào đây. Nó có thông báo riêng
(`tiktokCodeAlreadyUsed`) nói rõ phải uỷ quyền lại để lấy mã mới, và nói thêm
rằng nếu lần đổi trước đã thành công thì token đã nằm trong kết nối rồi.

---

### Vì sao cần `verify:live`

Hai bug dưới đây **không có cách nào bắt được offline** — chúng chỉ lộ ra khi
gọi API với credential thật, và cả hai đều làm token hợp lệ bị báo là sai:

**Tên field khác nhau giữa hai endpoint.** TikTok trả về `advertiser_name` ở
`/oauth2/advertiser/get/` nhưng đòi `name` ở `/advertiser/info/`, và từ chối
thẳng nếu dùng sai:

```
code 40002: fields.1: one or more value of the param is not acceptable,
correct is ['status', … 'name', …], error is advertiser_name
```

`/advertiser/info/` chính là probe **chỉ dùng token**, nên tên field sai ở đó
làm một token hoàn toàn hợp lệ bị báo là bị từ chối — ngược hẳn sự thật.

**Advertiser ID nằm ở hai nơi.** Người dùng có thể tự nhập, nhưng thường thì
lần kiểm tra kết nối thành công sẽ *tự phát hiện* và lưu vào `metadata`. Đọc
mỗi `credentials` khiến phần chẩn đoán báo "không có advertiser để thử token"
trên một kết nối đã tìm được 24 cái. Giờ `advertiserIdFrom()` trong
`src/plugins/tiktok-ads/context.ts` là định nghĩa duy nhất, dùng chung cho
`resolveParams`, `testConnection` và cả hai action.

Chạy khi thêm connector mới hoặc sửa catalogue:

```bash
TT_APP_ID=… TT_SECRET=… TT_ACCESS_TOKEN=… npm run verify:live
```

Nó tạo project tạm, gọi `testConnection`, cả hai action, bốn endpoint trong
catalogue, rồi kiểm tra token và secret **không** xuất hiện trong bản echo của
request — và xoá sạch mọi thứ nó tạo ra ở cuối.

---

## Vươn tới phần API mà catalogue chưa có

### Không nhà cung cấp nào công bố spec — đã kiểm tra

Câu hỏi tự nhiên là: sao không tự sinh catalogue từ OpenAPI của nhà cung cấp?
Tôi đã dò 11 đường dẫn tiêu chuẩn:

| Thử | Kết quả |
|---|---|
| `business-api.tiktok.com/openapi.json`, `/swagger.json`, `/open_api/v1.3/openapi.json`, `/.well-known/openapi.json` | 404 |
| `business-api.tiktok.com/portal/docs/openapi.json` | 200 nhưng `text/html` — là HTML của trang docs, không phải spec |
| `support.sapo.vn`, `developers.sapo.vn`, `{shop}.mysapo.net/admin/openapi.json` | 404 / 401 |

Cũng không có endpoint nào để hỏi scope: `/oauth2/app/info/`,
`/oauth2/permission/list/`, `/tool/permission/get/`, `/oauth2/scope/get/` đều
404. (Một phát hiện phụ: `/app/info/` **có tồn tại** — nó trả 40105 chứ không
404 — nên nó là endpoint thật mà catalogue chưa khai báo.)

Kết luận: **không thể tự sinh catalogue.** Nên thay vì hứa điều không làm được,
có hai đường vòng, và cả hai đều bỏ hẳn việc phải sửa code.

### 1. Gọi tự do — tab thứ hai trong API Hub

Nhập method, đường dẫn tương đối, tham số query, body nếu cần. Request đi qua
**đúng pipeline** của endpoint đã khai báo: cùng cách giải mã credential, cùng
cách che secret trong bản echo, cùng dòng ghi vào `api_call_logs` (đánh dấu
`custom:GET /app/info/` để nhìn là biết không phải endpoint trong danh mục).
Đây không phải cửa sau — nó bị soi y như mọi request khác.

Điền thêm "đường dẫn tới danh sách bản ghi" (`data.list`, `orders`…) là tab
**Bản ghi** và **Cấu trúc** hoạt động luôn, kể cả với endpoint chưa khai báo.

**Vì sao đây là chỗ nguy hiểm nhất trong toàn bộ dự án.** Cho người dùng định
hình một URL rồi gửi kèm credential của kết nối chính là công thức SSRF: trỏ vào
dịch vụ nội bộ và ứng dụng trở thành *confused deputy* đang cầm bearer token
thật. Phòng thủ không phải blocklist — đường dẫn được ghép vào base URL của
connector rồi **kiểm tra lại là vẫn nằm trong đó**, nên mọi cách thoát ra, bằng
bất kỳ kiểu mã hoá nào, đều fail giống nhau:

```
POST /api/hub/custom   path=https://evil.example/x        -> PATH_NOT-RELATIVE
                       path=//evil.example/x              -> PATH_NOT-RELATIVE
                       path=../../../admin                -> PATH_ESCAPES-BASE
                       path=..%2f..%2fadmin               -> PATH_ENCODED-SEPARATOR
                       path=http://169.254.169.254/…      -> PATH_NOT-RELATIVE
```

Metadata service của cloud và localhost bị chặn vì chúng **tuyệt đối**, không
phải vì có trong danh sách đen — nên không cần bảo trì danh sách IP nào.

`npm run check:paths` chạy 33 assertion trên module này: mọi hình thái tấn công
phải bị từ chối, **và** mọi đường dẫn hợp lệ phải sống sót — một quy tắc chỉ làm
nửa đầu thì vô dụng.

Phân quyền theo method, vì hai việc khác nhau: đọc một đường dẫn chưa khai báo
là việc của Biên tập (`hub:custom`), còn **ghi** vào đó cần Quản trị
(`hub:custom-write`) — bởi chưa ai kiểm duyệt endpoint đó làm gì.

### 2. Liệt kê endpoint kết nối có quyền

Không có API quyền để tra, nên câu trả lời trung thực chỉ đến từ việc thử. Công
cụ này gọi **từng endpoint chỉ-đọc** trong catalogue đúng một lần với request
nhỏ nhất hợp lệ, rồi trả về checklist: được phép / bị từ chối / không thử được.

Cố tình hẹp: chỉ GET, chỉ một trang (`page_size=1`), và endpoint có thể thay
đổi dữ liệu bị **bỏ qua mà không gọi** — một công cụ kiểm tra quyền mà tạm dừng
chiến dịch để biết mình có quyền tạm dừng chiến dịch thì tệ hơn là không có.

Endpoint không tạo được request hợp lệ (thiếu tham số bắt buộc) được báo là
"không thử được" chứ không phải "bị từ chối" — vì nó không nói gì về quyền.

Action này là **generic**, dùng chung cho mọi connector, vì nó hỏi nhà cung cấp
chứ không tra bảng.

---

### 3. Catalogue rộng: 152 endpoint TikTok, hai mức tin cậy khác nhau

Danh mục TikTok có **152 endpoint**, nhưng chúng không cùng loại, và sự khác
nhau đó được ghi vào **dữ liệu** thay vì để người đọc code tự đoán:

| | Số lượng | Nguồn | Cờ |
|---|---|---|---|
| **Đã kiểm chứng** | 9 | Tham số, envelope và trường khoá đọc từ docs rồi đối chiếu với tài khoản thật | — |
| **Khai từ đường dẫn** | 143 | Chỉ có đường dẫn; method và tham số được suy luận | `unverified: true` |

Cả hai đều hữu ích, và **không thay thế được nhau**. Một catalogue có thể rộng
hoặc đã được xác nhận, không thể vừa rộng vừa xác nhận cùng lúc — nên thay vì
chọn một bên, mỗi entry tự khai nó thuộc bên nào. Hệ quả cụ thể:

- API Hub gắn nhãn "suy luận từ đường dẫn" và giải thích ngay trên form.
- **Không lưu được dataset** từ entry suy luận. Đây không phải sự cẩn thận quá
  mức: `externalIdOf` rơi về `row-<index>` khi không có trường khoá, nên lần
  đồng bộ sau — khi thứ tự bản ghi đổi — sẽ ghi đè chéo lên nhau. Xem dữ liệu
  thì được; giữ lại thì không.
- Không khai `pagination`, vì đó là lời cam kết rằng Hub đi hết được collection.

### Method được suy ra thế nào, và vì sao lệch về phía "ghi"

TikTok đặt tên hành động ở **segment cuối** của đường dẫn, nên chính segment đó
quyết định: `create`, `update`, `delete`, `assign`, `bind` → POST;
`get`, `list`, `info`, `check` → GET.

Chỗ nào mơ hồ thì khai **POST**, vì sai lệch có giá không đối xứng:

- Khai POST cho một endpoint thật ra là GET → form báo lỗi. Nhìn thấy được, sửa
  được bằng tab Gọi tự do.
- Khai GET cho một endpoint thật ra là **ghi** → công cụ "liệt kê endpoint có
  quyền" sẽ **tự gọi nó thật** trên tài khoản đang chạy quảng cáo. Không ai bấm
  gì cả.

Quy tắc đó không nằm ở thói quen mà được **chặn ở hai tầng độc lập**:

1. `endpoints-declared.ts` **throw ngay khi import** nếu một đường dẫn mang
   động từ ghi mà bị khai GET — không code nào import được catalogue như vậy.
2. `check:plugins` phát biểu lại cùng quy tắc bằng một regex **riêng**. Nếu
   dùng lại regex của plugin thì check chỉ đồng ý với chính nó và không chứng
   minh được gì; viết lại nghĩa là nới lỏng ở một nơi sẽ bị nơi kia bắt.

Đã kiểm chứng bằng cách cố tình phá: đổi `/bc/asset_group/delete/` thành GET
→ import fail; đổi một endpoint đã kiểm chứng thành `/pixel/assign/` → check
báo `✗ GET /pixel/assign/`.

Còn hai điểm nữa `check:plugins` giữ, cả hai đều từ lỗi thật có thể xảy ra:
**không hai endpoint trùng method + path** (một entry suy luận có thể lặng lẽ
che một entry đã kiểm chứng, vì Hub và probe đều lấy match đầu tiên), và
**entry `unverified` không được khai `pagination` hay `idField`** — hai
thứ đòi hỏi phải biết chắc.

### Probe chạy song song, và giới hạn 6 là vì nhà cung cấp

Với 152 endpoint, vòng lặp tuần tự cũ trở thành nút cổ chai: ~80 request khả
thi × vài trăm ms là gần một phút, và ngân sách 40 request cũ **che mất nửa
catalogue** sau dòng "budget reached" thay vì trả lời câu hỏi.

Giới hạn 6 request đồng thời được chọn theo **nhà cung cấp**, không theo client:
TikTok rate-limit theo app, và một probe làm chạm trần sẽ báo "bị từ chối" cho
endpoint mà token thật ra có quyền — đúng câu trả lời sai duy nhất mà công cụ
này không được phép đưa ra.

Việc **quyết định gọi gì** được tách khỏi việc **gọi**: mọi lý do bỏ qua được
chốt trước, theo thứ tự catalogue, nên checklist người dùng đọc luôn giữ đúng
thứ tự bất kể response về theo trình tự nào.

### Endpoint ghi nhận body thế nào

Một endpoint ghi nhận **một object JSON duy nhất**, dán từ docs. Sinh ra các
field có kiểu sẽ là bịa ra chúng. `buildRequest` **spread** object đó ở tầng
trên cùng để nhà cung cấp thấy đúng tên field của họ, không phải một khoá
`body` lồng trong. `advertiser_id` / `bc_id` được merge **sau**, nên tài
khoản người dùng chọn trên form thắng một id cũ còn sót trong JSON đã dán.

---

## Phân quyền

Vai trò trong project được xếp hạng: quyền cao bao trùm quyền thấp.

| Khả năng | Owner | Admin | Editor | Booking | Viewer |
|---|---|---|---|---|---|
| Xem project, danh mục API, dữ liệu, dữ liệu booking | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thêm/sửa/xoá/nhập booking và chiến dịch booking | ✅ | ✅ | ✅ | ✅ | — |
| Gọi API, đồng bộ dataset | ✅ | ✅ | ✅ | — | — |
| Gọi đường dẫn tự do — **đọc** | ✅ | ✅ | ✅ | — | — |
| Gọi đường dẫn tự do — **ghi** | ✅ | ✅ | — | — | — |
| Thêm/sửa/xoá kết nối API | ✅ | ✅ | — | — | — |
| Mời và phân quyền thành viên | ✅ | ✅ | — | — | — |
| Sửa cài đặt project | ✅ | ✅ | — | — | — |
| Xoá project | ✅ | — | — | — | — |

Ngoài ra `user.role` ở cấp hệ thống là `admin` hoặc `user`, độc lập với vai trò
project. Một người có thể tạo nhiều project riêng biệt và chia sẻ từng project
cho những người khác nhau với vai trò khác nhau.

Chia sẻ project bằng liên kết mời có hạn 7 ngày, gắn với đúng địa chỉ email được
mời — chuyển tiếp liên kết cho người khác không dùng được.

---

## Bảo mật

- **Credential được mã hoá AES-256-GCM** trước khi lưu, khoá nằm ở
  `APP_ENCRYPTION_KEY`. Việc giải mã chỉ xảy ra trong `core/plugins/execute.ts`,
  ngay trong request đang thực sự gọi nhà cung cấp.
- **Giá trị secret không bao giờ về browser.** Form sửa kết nối chỉ biết một field
  đã có giá trị hay chưa, không biết giá trị là gì.
- **Request echo được che hai lớp**: che theo tên header/param, và scrub theo
  đúng giá trị secret thật — kể cả trong body và trong phần đã percent-encode.
  Lớp này được kiểm tra tự động vì `api_call_logs.url` lưu lâu dài.
- **Project id không bị lộ sự tồn tại**: mọi truy vấn project đi qua bảng thành
  viên, nên id không có quyền và id không tồn tại trả về giống nhau.
- Đăng nhập sai không phân biệt "sai email" với "sai mật khẩu".

---

## Dữ liệu và tính toán

Dữ liệu lấy về được lưu thô dạng JSONB trong `dataset_records`, kèm `external_id`
để lần đồng bộ sau *upsert* thay vì nhân bản. Mọi connector ghi cùng một hình
dạng, nên lớp phân tích phía sau có thể tái cấu trúc mà không cần migration
riêng cho từng nhà cung cấp. `datasets.field_hints` giữ schema suy luận từ lần
đồng bộ gần nhất, hiển thị ở tab **Cấu trúc** trong API Hub.

Khi khối lượng đủ lớn để JSONB không còn đủ nhanh, hướng mở rộng là dựng bảng
mart đã chuẩn hoá bên cạnh, đọc từ landing zone này — không phải viết lại phần
thu nhận dữ liệu.

---

## Bốn báo cáo: Booking & KOC, Video & GMV, Chi phí & ROI, Đơn & huỷ

Bốn nguồn, nối với nhau bằng ba khoá:

| Nguồn | Plugin | Dùng cho |
|---|---|---|
| Dữ liệu booking | — (trong ứng dụng) | Mã KOC, ngày book/air, ID video, ID sản phẩm, chi phí |
| TikTok Shop | `tiktok-shop` | Đơn hàng + voucher, đơn affiliate (KOC, video, hoa hồng — cần scope affiliate; thiếu scope thì báo cáo bỏ qua, không cảnh báo), video mới, số sao |
| TikTok Ads | `tiktok-ads` | GMV Max theo sản phẩm và theo video, ROI mục tiêu |
| Sapo | `sapo` | Đơn khởi tạo/huỷ theo sản phẩm và theo giờ |

| Khoá | Cách khớp |
|---|---|
| Sản phẩm | ID sản phẩm TikTok (= `item_group_id` của GMV Max). Sapo không biết ID này — khớp qua **seller SKU** trên các đơn TikTok Shop |
| KOC | handle TikTok viết thường, bỏ `@` và link (`shared/keys.ts`) |
| Video | ID video, tách từ link nếu dữ liệu booking dán link |

| Báo cáo | Nguồn | Trả lời |
|---|---|---|
| Booking & KOC | Booking, TikTok Shop, TikTok Ads | Mỗi ngày: video booking air, tổng video gắn giỏ (phân tích video TikTok Shop), video tự gắn giỏ = tổng − booking, video GMV Max phân phối; tác động của booking lên video tự nhiên (ngày có vs không booking, tương quan); xu hướng GMV Max so với booking. Không dùng API affiliate |
| Video & GMV sản phẩm | Booking, TikTok Shop | Video booking air, video mới gắn sản phẩm, GMV sản phẩm; tương quan ba yếu tố |
| Chi phí & ROI | TikTok Shop, TikTok Ads, Booking | Voucher TikTok/shop (không tính đơn huỷ), chi phí ads theo KOC/sản phẩm, hoa hồng, GMV khách đặt vs GMV ads, đánh giá xấu, ROI mục tiêu tốt nhất |
| Đơn & huỷ | Sapo, TikTok Ads, TikTok Shop (để khớp SKU) | Đơn khởi tạo/huỷ theo sản phẩm, đơn từ ads, giờ ra đơn nhiều nhất, giờ huỷ ít nhất |

### Quy tắc module / widget

Mỗi báo cáo là một thư mục trong `src/modules/`: `module.ts` (mục menu), `types.ts`
(hình dạng câu trả lời), `report.ts` (server dựng câu trả lời), `widgets/` (mỗi thẻ
một thư mục, khai báo band, thứ tự, độ rộng và **nguồn cần có**), `page.tsx`. Khung
chung (`modules/analytics/shell/report-page.tsx`) lo bộ lọc kỳ (7/30/90 ngày, tuỳ
chọn đến 186 ngày) và gộp **theo ngày/tháng**, trạng thái nguồn, tự làm mới, và
cách ly widget lỗi. Thêm một thẻ = một thư mục + một dòng trong `widgets/index.ts`.
Thêm một báo cáo = một thư mục + một dòng trong `modules/index.ts` và `modules/reports.ts`
+ một file route trang.

Tương quan giữa hai chỉ số là **Pearson r qua các kỳ** (ngày hoặc tháng), cần ít
nhất 5 kỳ có đủ cả hai số — ít hơn thì thẻ nói "chưa đủ" thay vì gọi tên một mối
quan hệ. Kỳ thiếu dữ liệu là **khoảng trống**, không phải số 0.

### Dữ liệu lưu theo ngày

`modules/analytics/data/day-store.ts` giữ số liệu tổng hợp **theo ngày** trong
`.data/cache/<nguồn>-<connectionId>.json` — theo sản phẩm, theo KOC, không theo
từng đơn — và chỉ đọc lại ngày còn có thể thay đổi:

| Kho | Đọc lại |
|---|---|
| Đơn TikTok Shop | hôm nay mỗi 15 phút, 7 ngày gần 3 giờ/lần, cũ hơn thì giữ |
| Đơn affiliate | hôm nay 30 phút, 30 ngày gần (hoa hồng còn quyết toán) 12 giờ/lần |
| Video, hiệu quả sản phẩm, số sao | 3 ngày gần mỗi 3 giờ (TikTok có số liệu trễ 1–2 ngày), 10 ngày gần mỗi ngày |
| GMV Max | theo cửa sổ cố định 30 ngày; cửa sổ chạm hôm nay 15 phút, cũ 6 giờ (bộ nhớ) |
| Sapo | kho ngày sẵn có của Tổng quan (thêm SKU và giờ theo sản phẩm, `PRODUCTS_VERSION` 3) |

Trang báo "Đang đồng bộ" và tự hỏi lại mỗi 6 giây khi còn ngày đang đọc. Trên máy
chủ, tiến trình nền giữ sẵn 35 ngày gần nhất của TikTok Shop.

### Những gì API không cho, và cách xử lý

- **TikTok không có API liệt kê đánh giá** — chỉ có phân bố số sao của *một* sản
  phẩm trong một khoảng. Mỗi ngày báo cáo hỏi cho **25 sản phẩm bán chạy nhất**;
  "đánh giá xấu" = 1–2 sao.
- **TikTok không lưu lịch sử ROI mục tiêu** (`roas_bid`) — chỉ giá trị hiện tại.
  EHub ghi lại mỗi ngày (`.data/cache/gmv-targets-*.json`) từ lần đầu mở báo cáo;
  "mức tốt nhất" chỉ có khi một mức đã chạy ít nhất 3 ngày: trong các mức TikTok
  đạt được (ROI thực ≥ mục tiêu), mức mang về GMV/ngày cao nhất.
- **Đơn affiliate không có "GMV"** — dùng `estimated_commission_base` (giá × số
  lượng). Hoa hồng là **ước tính** cho đến khi quyết toán.
- **Chi phí ads theo KOC**: chi tiêu GMV Max theo video (`item_id`), gán cho KOC
  qua dữ liệu booking (ID video → KOC), rồi dữ liệu video/affiliate của TikTok Shop.
  Video không xác định được KOC được báo riêng, không chia.

### Kết nối TikTok Shop

1. Partner Center → tạo app, bật scope: *Shop Authorized Information*, *Order
   Information*, *Product Basic*, *Read Seller Affiliate Collaboration*, *TikTok Shop
   Analytics*. Lấy App Key, App Secret.
2. Mở link uỷ quyền của app bằng tài khoản chủ shop; TikTok chuyển về `…?code=XXXX`.
3. Cài đặt → Kết nối API → TikTok Shop: dán App Key, App Secret, và `XXXX` vào ô
   auth_code → Lưu. Hệ thống đổi lấy access + refresh token, và **tự làm mới** access
   token một ngày trước khi hết hạn (`refreshCredentials` +
   `core/plugins/fresh-credentials.ts` — nơi duy nhất ngoài lúc lưu/action được ghi
   credential).

Danh mục trong API Hub: **156 endpoint** — 11 đã đọc kỹ tài liệu (`endpoints.ts`) và
145 khai từ đường dẫn (`endpoints-declared.ts`, nhãn "suy luận từ đường dẫn"): đơn
hàng, sản phẩm, fulfillment, kho, FBT, tài chính, khuyến mãi, huỷ/trả hàng, phân tích,
affiliate (seller, creator app, partner app), CSKH, webhook. Endpoint khai từ đường dẫn
nhận tham số tự do: ô **query (JSON)** và ô **body (JSON)** dán theo tài liệu; hệ thống
tự thêm `app_key`, `timestamp`, `shop_cipher` và ký. Mọi endpoint ghi dữ liệu được đánh
dấu `mutating` (Hub hỏi xác nhận, công cụ dò quyền không gọi).

Ký request (`plugins/tiktok-shop/sign.ts`): mọi query trừ `sign`/`access_token`,
sắp xếp theo khoá, nối `key+value`, thêm path phía trước và body phía sau, bọc bằng
app_secret, HMAC-SHA256 hex. `check:plugins` kiểm lại quy tắc này bằng một bản viết
tay độc lập.

### Dữ liệu booking và chiến dịch booking

Dữ liệu booking nằm ngay trong ứng dụng (menu **Dữ liệu booking**, `src/modules/bookings`),
không cần kết nối ngoài. Người có vai trò **Booking** (hoặc Editor trở lên) thêm, sửa,
xoá, chuyển chiến dịch, hoặc **nhập hàng loạt** từ Excel (.xlsx, .xls), OpenDocument,
CSV/TSV hay dán thẳng vùng ô từ Excel/Google Sheets. Mọi người trong project đều xem được.

**Chiến dịch booking** (`campaigns.ts`) gom các booking của một đợt. Form chiến dịch
hiện đủ các nhóm: *Chiến dịch*, *Thời gian* (chip 7 ngày / 30 ngày / hết tháng),
*Tự điền cho mỗi booking* (sản phẩm chính, chi phí thường dùng), *Ngân sách & mục
tiêu* (có ngân sách và chi phí thì gợi ý số video mua được). Chỉ tên là bắt buộc; cũng
có thể gõ tên mới ngay trong form thêm booking. Chiến dịch là
các tab trên danh sách; dòng tóm tắt dưới tab cho biết số booking, đã air (so với
mục tiêu), chờ air và chi phí (so với ngân sách). Xoá chiến dịch không xoá booking của nó.

Trang được làm để theo dõi và thao tác ngay trên danh sách (`triage.ts`):

- Chip **Cần xử lý** gom booking chờ air quá 7 ngày và booking đã air nhưng thiếu link
  video; chip trạng thái kèm số đếm.
- Booking chờ air có nút **Dán link** ngay trên dòng: dán là lưu, booking chuyển sang
  *Đã air* theo ngày đăng video; link của KOC khác bị từ chối.
- Mỗi dòng hiện KOC đầy đủ: tên, liên hệ, số lần đã book và tổng chi. Bấm **@KOC** mở
  ngăn thông tin KOC (`koc-drawer.tsx`): hồ sơ, link TikTok, thống kê, toàn bộ lịch sử
  booking và nút *Book lại*; sửa tên/liên hệ ở đây áp dụng cho mọi booking của KOC.
- Form sửa (booking, chiến dịch, KOC) chỉ hiện nút *Lưu thay đổi* khi thông tin đã khác đi.
- Bấm dòng để sửa; menu ⋯ để huỷ/khôi phục, xoá. Chọn nhiều dòng thì thanh lọc đổi
  thành thao tác hàng loạt (chuyển chiến dịch, huỷ, khôi phục, xoá).
- Nhập file, xuất Excel, tải file mẫu nằm trong menu ⋯ đầu trang; phím **N** để thêm booking.

Chuẩn trường (`fields.ts`): *Chiến dịch*, *ID KOC* (bắt buộc), *Tên KOC*, *Liên hệ*,
*Ngày book* (bắt buộc), *Ngày air*, *Link video*, *ID sản phẩm*, *Chi phí booking*
(bắt buộc), *Trạng thái* (Chờ air / Đã air / Đã huỷ), *Ghi chú*. Nút **Tải file mẫu**
cho file .xlsx có sẵn tiêu đề chuẩn và sheet hướng dẫn từng cột; **Xuất Excel** ra
đúng bố cục đó nên sửa xong nhập lại được.

Form thêm/sửa booking hiện đủ các trường, chia nhóm *KOC*, *Booking*, *Thời gian &
trạng thái* (`form-parts.tsx` dùng chung với form chiến dịch). Giá trị tự tính hiện
ngay trong ô, đánh dấu ✦ tự động; gõ đè để đổi, xoá trắng để trả lại tự động.

- Dán link video là đủ: KOC lấy từ link, ngày air từ ID video (32 bit đầu của ID là
  thời điểm đăng), ngày book theo ngày air. Chỉ @KOC thì là booking *Chờ air*, ngày
  book hôm nay.
- KOC đã từng book tự điền tên, liên hệ, chi phí lần trước; chiến dịch tự điền sản
  phẩm và chi phí thường dùng; chi phí chọn nhanh bằng chip.
- **Dán nhiều dòng** (`quick-entry.ts`) là thêm hàng loạt trong cùng form: mỗi dòng
  một link, ID video hoặc @KOC, chi phí riêng ghi sau nếu khác.
- *Lưu & thêm tiếp* giữ chiến dịch, sản phẩm và chi phí; Ctrl+Enter để lưu.

Khi nhập file, cột được nhận theo tiêu đề (không phân biệt dấu, hoa thường — *Mã KOC*,
*Link kênh*, *Cast*, *Link air*, *Ngày lên video*… đều nhận), cột lạ ghép tay được.
Từng dòng được kiểm tra trước khi gửi: ngày `12/09/2026`, `12/9`, ô ngày Excel; tiền
`1.500.000đ`, `1,5tr`, `1tr5`, `500k`; link video phải có ID; ngày air không trước
ngày book. Chiến dịch ghi trong file mà chưa có sẽ được tạo; dòng không ghi chiến dịch
vào chiến dịch chọn lúc nhập. Dòng lỗi được đánh dấu và tải về được để sửa. Dòng cùng video với dòng
đã có thì **cập nhật** thay vì nhân đôi; dòng trùng hệt (không có video) bị bỏ qua.
Server kiểm lại cùng quy tắc, và mọi thay đổi được ghi vào audit log. Dòng *Đã huỷ*
không tính vào báo cáo.

---

## Triển khai lên máy chủ và cập nhật ngay trong ứng dụng

Máy chủ: VPS Ubuntu 22.04/24.04, dữ liệu trên PostgreSQL. Chỉ cài tay **một lần**;
mọi phiên bản sau được gửi và áp dụng từ trang **Cập nhật hệ thống** (menu tài
khoản, chỉ Administrator thấy).

### Cài lần đầu

Làm một lần duy nhất, khoảng 20–30 phút (phần lớn là chờ). Cần hai máy:

- **Máy local**: máy Windows đang code, nơi `npm run dev` chạy được. Các lệnh
  máy local gõ trong **PowerShell**, tại thư mục dự án.
- **VPS**: máy chủ Ubuntu. Các lệnh VPS gõ trong cửa sổ SSH đã đăng nhập vào
  VPS (bước 5).

Ví dụ bên dưới dùng giá trị mẫu; **thay bằng của bạn** ở mọi chỗ:

| Giá trị mẫu | Thay bằng |
|---|---|
| `203.0.113.10` | địa chỉ IP của VPS (nhà cung cấp gửi khi tạo VPS) |
| `adshub.congty.vn` | tên miền (hoặc tên miền con) sẽ dùng cho EHub |
| `ban@congty.vn` | email của bạn (Let's Encrypt gửi thông báo chứng chỉ về đây) |
| `adshub-0.1.0-20260911-064748.bundle` | tên file bundle mà bước 3 in ra |

#### Cần chuẩn bị

| Thứ | Yêu cầu |
|---|---|
| VPS | Ubuntu **22.04 hoặc 24.04**, 64-bit, mới cài, chưa chạy gì. RAM từ 2 GB (1 GB vẫn được, script tự thêm swap). Ổ đĩa từ 20 GB |
| Đăng nhập VPS | SSH bằng `root`, hoặc một user có `sudo` (một số nhà cung cấp cho user `ubuntu`) |
| Tên miền | Bắt buộc. Máy local chỉ gửi bản cập nhật qua `https://`, mà HTTPS cần tên miền |
| Tường lửa | Mở cổng **22, 80, 443**. Nếu nhà cung cấp có tường lửa riêng trên trang quản lý VPS, mở ở đó |
| Máy local | Dự án chạy được bằng `npm run dev`, bạn đăng nhập được bằng tài khoản Administrator |

#### Bước 1: Trỏ tên miền về VPS (máy local, trang quản lý tên miền)

Làm đầu tiên vì DNS cần thời gian để có hiệu lực. Ở trang quản lý DNS của nơi mua
tên miền, thêm một bản ghi:

| Loại | Tên | Giá trị | TTL |
|---|---|---|---|
| `A` | `adshub` (phần đứng trước tên miền chính; dùng `@` nếu là tên miền chính) | `203.0.113.10` | mặc định |

Kiểm tra trong PowerShell:

```powershell
nslookup adshub.congty.vn
```

Phải thấy `Address: 203.0.113.10`. Nếu chưa thấy, đợi thêm (thường vài phút, có
khi vài giờ). Có thể làm tiếp bước 2–4 trong lúc chờ, nhưng **không chạy bước 5
khi tên miền chưa trỏ đúng**, vì bước lấy chứng chỉ HTTPS sẽ thất bại.

#### Bước 2: Kiểm tra kết nối SSH (máy local)

```powershell
ssh -V
ssh root@203.0.113.10
```

- `ssh -V` in ra phiên bản OpenSSH là được. Nếu báo không có lệnh `ssh`: vào
  Settings → System → Optional features → thêm **OpenSSH Client**.
- Lần đầu kết nối, SSH hỏi `Are you sure you want to continue connecting?`: gõ
  `yes`, rồi nhập mật khẩu VPS. Khi gõ mật khẩu, màn hình không hiện ký tự nào;
  đó là bình thường.
- Vào được là thấy dấu nhắc kiểu `root@ten-vps:~#`. Gõ `exit` để thoát.
- Nhà cung cấp cho đăng nhập bằng file khoá thay vì mật khẩu: thêm
  `-i C:\duong-dan\file-khoa` vào mọi lệnh `ssh` và `scp` bên dưới.
- Không có `root`, chỉ có user `ubuntu`: thay `root@` bằng `ubuntu@` và `/root/`
  bằng `/home/ubuntu/` ở mọi lệnh bên dưới.

#### Bước 3: Đóng gói code (máy local)

```powershell
cd C:\Users\kasco\OneDrive\Desktop\EHub
npm run release:bundle
```

Kết quả có dạng:

```
✓ Bundle written: adshub-0.1.0-20260911-064748.bundle
  189 files, 0.50 MB packed
```

File `.bundle` nằm ngay trong thư mục dự án. **Ghi lại đúng tên file**, vì bước 4
và 5 cần tên đầy đủ: PowerShell không tự hiểu dấu `*` khi chạy `scp`. Mẹo: gõ
`.\adshub-` rồi nhấn Tab để tự điền tên. Dev server đang chạy cũng không sao, lệnh
này chỉ đọc file. Mỗi lần chạy lại tạo một file mới; file cũ có thể xoá.

#### Bước 4: Chép bundle và script cài lên VPS (máy local)

```powershell
scp .\adshub-0.1.0-20260911-064748.bundle .\deploy\install.sh root@203.0.113.10:/root/
```

Lệnh này chép **hai** file vào thư mục `/root/` của VPS, mỗi file hiện một dòng
`100%`.

> ⚠ **Đừng quên phần cuối `root@203.0.113.10:/root/`.** Thiếu phần đó, `scp`
> chép ngay trên máy local và **ghi đè `deploy\install.sh` bằng file bundle**.
> Kiểm tra `deploy\install.sh` còn nguyên:
> `Get-Content .\deploy\install.sh -TotalCount 1` phải in ra `#!/usr/bin/env bash`.
> Từ nay `npm run release:bundle` cũng từ chối đóng gói nếu file này bị hỏng.

#### Bước 5: Chạy script cài (VPS)

Đăng nhập VPS từ PowerShell:

```powershell
ssh root@203.0.113.10
```

Từ đây là lệnh trên VPS:

```bash
cd /root
ls -l *.bundle install.sh          # phải thấy đủ hai file
sed -i 's/\r$//' install.sh        # sửa kiểu xuống dòng Windows, nếu có; chạy thừa cũng không hại gì
tmux new -s adshub                 # phiên làm việc không bị ngắt khi rớt mạng (xem ghi chú bên dưới)
bash install.sh --bundle /root/adshub-0.1.0-20260911-064748.bundle --domain adshub.congty.vn --email ban@congty.vn
```

User `ubuntu` thay vì root: `sudo bash install.sh --bundle /home/ubuntu/adshub-….bundle --domain … --email …`.

`tmux` giữ script chạy tiếp nếu kết nối SSH bị rớt giữa chừng. Kết nối lại bằng
`ssh root@203.0.113.10` rồi `tmux attach -t adshub` để xem tiếp. Khi script
xong, gõ `exit` hai lần để thoát tmux rồi thoát VPS.

Script chạy khoảng **10–20 phút** và in ra từng phần:

| Dòng in ra | Việc đang làm |
|---|---|
| `adshub.congty.vn → 203.0.113.10; this server: 203.0.113.10 …` | So tên miền với IP VPS. Hai IP phải trùng nhau |
| `▸ System packages` | Cài Nginx, PostgreSQL, Certbot |
| `▸ Memory` | Thêm swap 2 GB nếu RAM dưới 3 GB (để build không bị thiếu bộ nhớ) |
| `▸ Node.js 22 and PM2` | Cài Node.js và trình quản lý tiến trình PM2 |
| `▸ App user and directories` | Tạo user hệ thống `adshub` và thư mục `/opt/adshub` |
| `▸ PostgreSQL database and settings` | Tạo CSDL `adshub` với mật khẩu ngẫu nhiên. Ghi `/opt/adshub/shared/.env.local` (mọi khoá bí mật sinh mới) |
| `▸ First release` | Kiểm tra và giải nén bundle |
| `▸ Dependencies, database schema and build` | `npm ci`, migrate, `next build`. **Lâu nhất**, có lúc vài phút không in gì |
| `▸ Process manager` | PM2 chạy app, tự bật lại khi VPS khởi động lại |
| `▸ Nginx`, `▸ HTTPS certificate` | Nginx đứng trước app, lấy chứng chỉ Let's Encrypt, chuyển http → https |
| `▸ Waiting for the app` | Chờ `/api/health` trả lời |

Khi xong, script in ra:

```
✓ EHub is running at https://adshub.congty.vn

Next:
  1. Open https://adshub.congty.vn now and register. The first account becomes the Administrator.
  2. On the development machine, add these two lines to .env.local and restart npm run dev:

       UPDATE_SERVER_URL=https://adshub.congty.vn
       UPDATE_SIGNING_KEY=q3V…(44 ký tự)…=
```

**Copy hai dòng `UPDATE_…`**, dùng ở bước 7. Lỡ đóng cửa sổ rồi thì xem lại
bằng: `sudo grep UPDATE_SIGNING_KEY /opt/adshub/shared/.env.local`.

#### Bước 6: Tạo tài khoản Administrator trên máy chủ (trình duyệt), làm ngay

Mở `https://adshub.congty.vn` → **Đăng ký**. **Tài khoản đăng ký đầu tiên tự
thành Administrator**, nên hãy đăng ký ngay sau khi cài xong, trước khi có ai khác
vào được trang.

Cấp quyền Administrator cho người khác sau này (người đó phải đăng ký tài khoản
trước), trên VPS:

```bash
cd /opt/adshub/current && sudo -u adshub npm run admin:grant -- email@cua-ho.vn
```

#### Bước 7: Nối máy local với máy chủ (máy local)

1. Mở file `.env.local` ở thư mục dự án (cùng chỗ với `package.json`), dán hai
   dòng đã copy ở bước 5 vào cuối file:

   ```
   UPDATE_SERVER_URL=https://adshub.congty.vn
   UPDATE_SIGNING_KEY=q3V…=
   ```

   - Dán **nguyên văn**: không thêm dấu nháy, không có khoảng trắng. Khoá dài 44
     ký tự và thường kết thúc bằng `=`; dấu `=` đó là một phần của khoá.
   - **Không** thêm `UPDATE_RECEIVER` ở máy local; biến đó chỉ dành cho máy chủ.
   - Khoá này ngang với chìa khoá gửi code lên máy chủ: không chia sẻ, không đưa
     lên git (`.env.local` đã nằm trong `.gitignore`).

2. Khởi động lại dev server, vì biến môi trường chỉ được đọc lúc khởi động: ở
   cửa sổ đang chạy `npm run dev`, nhấn **Ctrl+C**, rồi chạy lại `npm run dev`.

3. Kiểm tra: đăng nhập bằng tài khoản Administrator → bấm ảnh đại diện góc trên
   → **Cập nhật hệ thống**. Phải thấy thẻ **Gửi bản cập nhật lên máy chủ** ghi
   `https://adshub.congty.vn`, không có cảnh báo vàng.

   Trên máy chủ, cũng trang đó phải hiện: chip *Phiên bản đang chạy: 2026…-initial*,
   thẻ **Bản cập nhật chờ xác nhận** ("Chưa có bản cập nhật nào đang chờ"), không
   có cảnh báo vàng.

#### Bước 8: Thử một lần cập nhật (nên làm ngay)

Để chắc chắn cả luồng chạy thông trước khi thật sự cần đến:

1. Máy local → **Cập nhật hệ thống** → **Đóng gói & gửi** → hiện mã, ví dụ `K7Q2-9XMP`.
2. Máy chủ → **Cập nhật hệ thống** → nhập mã → **Xác nhận & cập nhật**.
3. Theo dõi 9 bước (khoảng 3–10 phút, chủ yếu là build). Tới bước *Khởi động lại*,
   trang báo máy chủ đang khởi động lại rồi tự kết nối lại. Kết thúc là
   **Cập nhật thành công**, và chip phiên bản đổi sang bản mới.

#### Kiểm tra nhanh trên VPS

```bash
sudo -u adshub pm2 status                     # dòng adshub phải là "online"
curl -s http://127.0.0.1:3000/api/health      # {"ok":true,"release":"…","version":"0.1.0"}
sudo -u adshub pm2 logs adshub --lines 50     # nhật ký của app (Ctrl+C để thoát)
ls -l /opt/adshub                             # current -> releases/…
ls -l /opt/adshub/shared/backups              # bản sao lưu CSDL trước mỗi lần cập nhật
```

#### Gỡ lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `$'\r': command not found` hoặc `set: pipefail: invalid option name` | `install.sh` bị đổi sang kiểu xuống dòng Windows | Trên VPS: `sed -i 's/\r$//' /root/install.sh`, rồi chạy lại |
| Chạy `bash install.sh` ra toàn ký tự lạ, hoặc `cannot execute binary file` | `install.sh` đã bị ghi đè bằng file bundle (xem cảnh báo ở bước 4) | Kiểm tra dòng đầu của `deploy\install.sh` ở máy local, rồi chép lại (bước 4) |
| `--bundle: file not found` | Sai tên hoặc sai đường dẫn file | `ls /root/*.bundle`, dán đúng tên đầy đủ |
| `ssh: connect to host … Connection timed out` | Sai IP, hoặc cổng 22 bị chặn | Kiểm tra IP và tường lửa ở trang quản lý VPS |
| `Permission denied (publickey)` | VPS chỉ cho đăng nhập bằng khoá | Thêm `-i C:\duong-dan\file-khoa` vào `ssh` và `scp` |
| Script dừng ở bước build, báo `Killed` hoặc `heap out of memory` | VPS thiếu RAM | `free -h` phải có dòng Swap khác 0. Cài lại theo mục bên dưới |
| `! … the HTTPS certificate was not issued` | Tên miền chưa trỏ về VPS, hoặc cổng 80/443 bị chặn | Sửa DNS/tường lửa, rồi: `sudo certbot --nginx -d adshub.congty.vn -m ban@congty.vn --agree-tos --redirect` |
| `EHub is already installed` | Đã cài rồi | Cập nhật từ trong app, hoặc làm theo *Cài lại từ đầu* |
| `The app did not start` | App lỗi khi khởi động | `sudo -u adshub pm2 logs adshub --lines 100` để xem lỗi |
| Máy local: *UPDATE_SERVER_URL không hợp lệ* | Thiếu `https://` | Sửa `.env.local`, khởi động lại dev |
| Máy local: *Máy chủ từ chối chữ ký* | Khoá hai máy khác nhau (thiếu ký tự, thừa dấu nháy hoặc khoảng trắng) | Copy lại khoá, khởi động lại dev |
| Máy local: *đồng hồ của hai máy lệch nhau* | Giờ hệ thống sai | Windows: Settings → Time & language → **Sync now**. VPS: `timedatectl` phải ghi `System clock synchronized: yes` |
| Máy local: *Không kết nối được tới máy chủ* | Sai địa chỉ, hoặc máy chủ đang tắt | Mở thử `https://adshub.congty.vn/api/health` trên trình duyệt |

#### Cài lại từ đầu

Khi lần cài trước hỏng giữa chừng (script đã báo `EHub is already installed`):

```bash
sudo -u adshub pm2 delete adshub
sudo rm -rf /opt/adshub/current /opt/adshub/releases
sudo bash /root/install.sh --bundle /root/adshub-0.1.0-20260911-064748.bundle --domain adshub.congty.vn --email ban@congty.vn
```

Cách này giữ nguyên `/opt/adshub/shared` (`.env.local`, mật khẩu CSDL, khoá cập
nhật, bản sao lưu) và mọi dữ liệu trong PostgreSQL. Khoá không đổi nên không phải
sửa gì ở máy local.

### Mỗi lần cập nhật

1. Máy phát triển → **Cập nhật hệ thống** → **Đóng gói & gửi** → nhập phiên bản
   (mặc định đã tăng số cuối so với bản máy chủ đang chạy, hoặc `package.json`
   nếu cao hơn; có thể sửa hoặc chọn nhanh Bản vá / Bản nhỏ / Bản lớn). Code được đóng
   gói (không kèm `node_modules`, `.next`, `.data`, file `.env`), ký bằng
   `UPDATE_SIGNING_KEY` và gửi lên máy chủ. Màn hình hiện **mã xác nhận** dạng
   `K7Q2-9XMP`.
2. Máy chủ → **Cập nhật hệ thống** → nhập mã → **Xác nhận & cập nhật**.
3. Máy chủ tự làm, trang hiện từng bước:

| Bước | Việc |
|---|---|
| Kiểm tra gói | SHA-256 đúng bản đã xác nhận, không đường dẫn nào ra ngoài thư mục phát hành |
| Sao lưu CSDL | `pg_dump` vào `/opt/adshub/shared/backups` (giữ 5 bản) |
| Giải nén → cài thư viện → migrate → build | vào một thư mục phát hành **mới**; bản đang chạy không bị đụng tới |
| Chuyển phiên bản | `current` trỏ sang bản mới trong một thao tác đổi tên nguyên tử |
| Khởi động lại → kiểm tra | PM2 reload; `/api/health` phải trả lời **đúng bản mới** |

Lỗi trước bước chuyển: bản cũ vẫn chạy, không có gì thay đổi. Lỗi sau bước
chuyển: `current` được trỏ về bản cũ và khởi động lại. Migration không được
hoàn tác (viết migration theo kiểu chỉ thêm); cần thì phục hồi từ bản `pg_dump`:
`pg_restore --clean -d adshub /opt/adshub/shared/backups/db-….dump`.

**Tự dọn dẹp** sau mỗi lần cập nhật:

| Thứ gì | Giữ lại |
|---|---|
| Bản phát hành (`/opt/adshub/releases`, mỗi bản ~1 GB) | 2 bản: bản đang chạy và bản trước đó để quay lại. Bản build dở của lần lỗi bị xoá ngay |
| Bản sao lưu CSDL | 5 bản mới nhất |
| Lịch sử và nhật ký từng lần cập nhật | 30 lần gần nhất |
| Gói cập nhật đã nhận | Xoá sau mỗi lần chạy |
| Nhật ký PM2 | Xoay vòng bằng `pm2-logrotate`: 10 MB mỗi file, giữ 7 file, nén |

**Tự dọn hằng ngày** khi app đang chạy (5 phút sau khi khởi động, rồi mỗi 24 giờ — `src/core/housekeeping.ts`):

| Thứ gì | Giữ lại |
|---|---|
| Nhật ký gọi API Hub (`api_call_logs`) | 30 ngày, tối đa 20.000 dòng mới nhất mỗi dự án |
| Nhật ký thay đổi (`audit_logs`) | 365 ngày |
| Phiên đăng nhập, mã xác minh | Xoá khi đã hết hạn |
| CSDL nhúng | `VACUUM` sau khi xoá, để dùng lại chỗ trống thay vì phình file |
| Bộ nhớ đệm `.data/cache` | Xoá file của kết nối đã xoá; file không được ghi 90 ngày (trừ lịch sử ROI mục tiêu và kho Sapo); file tạm sót lại sau sự cố; file hỏng chỉ giữ 3 bản mới nhất trong 14 ngày |
| Dung lượng đĩa | Cảnh báo trong nhật ký khi còn dưới 2 GB trống |

Cảnh báo lặp lại (một nguồn lỗi mỗi phút) chỉ ghi một lần, rồi tối đa mỗi giờ một lần kèm số lần lặp.

Không tự dọn: bộ nhớ đệm npm (`/home/adshub/.npm`, ~200 MB) và các file bạn tự
chép vào `/root`.

> Máy chủ luôn chạy **updater của bản đang chạy** (`scripts/apply-update.mjs`).
> Sửa chính file đó thì bản sửa chỉ có hiệu lực từ lần cập nhật **sau** lần mang
> nó lên — hoặc chép tay file đó lên máy chủ ngay.
>
> Mọi đường dẫn đọc lúc chạy trong `src/` (nhất là dưới `.data/`) phải có
> `path.join(/*turbopackIgnore: true*/ process.cwd(), …)`: trên máy chủ `.data`
> là symlink ra ngoài thư mục phát hành, và Turbopack làm hỏng build nếu lần theo nó.

### Vì sao an toàn

- Chỉ Administrator (vai trò cấp hệ thống) thấy và dùng được, ở cả hai máy.
- API nhận gói không dùng phiên đăng nhập mà đòi **chữ ký HMAC** trên thời
  điểm + nonce + SHA-256 của gói: chỉ máy có khoá mới gửi được, gói không bị
  sửa trên đường, hiệu lực 5 phút và không gửi lại được lần hai.
- Gói chỉ được **giữ**, không được áp dụng, cho tới khi nhập đúng mã. Mã sinh
  từ khoá và nội dung gói, **không đi kèm gói** — người xác nhận phải thấy màn
  hình máy gửi. Mã dùng một lần, hết hạn sau 30 phút, sai 5 lần là huỷ gói.
- Máy chủ đang dùng CSDL nhúng thì từ chối tự cập nhật: migrate khi app còn
  giữ CSDL nhúng sẽ làm hỏng dữ liệu.
- Mọi lần gửi, nhận, xác nhận, nhập sai mã đều ghi vào audit log.

| Biến | Ở đâu | Ý nghĩa |
|---|---|---|
| `UPDATE_SIGNING_KEY` | cả hai máy, **giống hệt nhau** | ký gói và sinh mã xác nhận |
| `UPDATE_SERVER_URL` | máy phát triển | địa chỉ máy chủ (`https://…`) |
| `UPDATE_RECEIVER=1` | máy chủ | cho phép nhận bản cập nhật |

---

## Ghi chú vận hành

**Thư mục dự án nằm trong OneDrive.** OneDrive sẽ cố đồng bộ `node_modules/`,
`.next/` và `.data/` — gây chậm và đôi khi lỗi khoá file. Nên loại trừ chúng:
chuột phải thư mục → *Free up space*, hoặc trong OneDrive → Settings →
Sync and backup → chọn thư mục không đồng bộ. Cả ba đã nằm trong `.gitignore`.

**Rotate `APP_ENCRYPTION_KEY`** sẽ làm mọi credential đã lưu không đọc được nữa;
khi đó cần nhập lại credential cho từng kết nối. Ứng dụng xử lý êm (hiện kết nối
với credential rỗng) chứ không sập.

---

## Bước tiếp theo

- Thêm connector: Meta Ads, Shopee, Lazada, Google Ads — theo hướng dẫn ở trên
- OAuth redirect đầy đủ cho TikTok (hiện đã có bước đổi `auth_code` thủ công)
- OAuth 2.0 flow (hợp đồng `AuthSpec` đã có sẵn chỗ cho `oauth`)
- Lịch đồng bộ tự động cho dataset
- Phân trang tự động khi lấy dữ liệu (`PaginationSpec` đã khai báo đủ thông tin)
- Bảng mart cho báo cáo: chi phí quảng cáo đối chiếu doanh thu đơn hàng
- Gửi email cho lời mời (hiện trả liên kết để tự gửi)
