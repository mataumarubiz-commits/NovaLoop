# SNS運用代行向け 業務OS SaaS 設計書 完全版 v3

> 対象: SNS運用代行 × 受託会社向けの「制作進行 + 請求 + 外注請求回収 + 振込 + freee同期 + ナレッジ」を一体化した業務OS
>
> 技術前提: Next.js (App Router) + Supabase (Postgres / RLS / Storage / Auth) + API Routes / Edge Functions
>
> この版で強化した点: 複数ロール方式、外注ポータル、外注請求自動回収、請求PDF自動保管、一括承認、一括振込、freee支払登録

---

##目的
このSaaSの目的は、SNS運用代行会社における「制作進行」と「締め業務」を分断なく繋ぎ、案件管理からクライアント請求、外注請求回収、振込、証憑保管、freee連携までを一つの業務OSとして成立させること。

狙う状態は次の通り。

- 日々は `/contents` がスプレッドシート以上に速く、漏れなく回る
- 月末月初は「案件管理 → 請求書ワンクリック作成 → 外注請求フォーム → 全請求書保管 → 振込自動化」が一気通貫で終わる
- 支払漏れがゼロになる
- 受託会社が「これがないと無理」と感じる業界標準になる

---

##北極星
- 毎日: 制作進行が1画面で回る
- 毎月: 締め業務が1画面で終わる
- 組織: 権限、承認、通知、監査が自然に回る
- 商品: 継続率改善・受注の決め手・上位プラン価値を同時に満たす

---

##成功指標
###事業KPI
- 支払漏れ件数: 0
- 月末処理時間: 導入前から大幅短縮
- 継続率: 改善
- 受注時の決め手としての言及率: 高い
- 上位プラン / オプション採用率: 高い

###プロダクトKPI
- 月次請求生成成功率
- 外注請求提出率
- 振込実行成功率
- freee同期成功率
- 二重送金防止率
- 失敗検知から再実行完了までの時間

###PMF判定の定性シグナル
- 「これがないと無理」
- 「スプシに戻れない」
- 「外注請求回収から振込まで1画面で終わる」

---

##対象顧客
- SNS運用代行会社
- ショート動画 / 投稿運用を受託している法人
- 月100〜1000本規模
- 外注比率が高い
- 年商1000万円以上
- 納期管理と締め処理が毎月重い会社

---

##商品設計
- モニター価格: 30万円
- 本ローンチ価格: 45万円
- 振込自動化: オプション課金
- 課金単位: サブスク

ただし商品訴求上はオプションであっても、営業メッセージの核として扱う。

---

##刺さる一言
- スプシで回していた制作進行と、月末の請求・外注請求回収・振込までを、1つの画面で終わらせる
- 外注請求回収から振込まで1画面で終わる

---

##業務全体フロー
###通常運用
1. `/contents` で案件・コンテンツを管理する
2. 各コンテンツにクライアント請求単価と外注原価を紐づける
3. 月次でクライアント請求書を一括生成する
4. 同時に外注請求ドラフトを自動生成する
5. 外注が専用フォームURLから自分の請求内容を確認し、請求する
6. 請求PDFと請求情報を自動保管する
7. 経理ロールが一括承認する
8. 経理ロールが再認証後に一括振込する
9. 結果を反映する
10. freeeへ支払登録する
11. 監査ログに承認・実行・結果を残す

###最重要の価値導線
案件管理 → クライアント請求 → 外注請求回収 → 証憑保管 → 振込 → freee

---

##スコープ
###MVP以降の本ローンチ必須
- 制作進行管理
- クライアント請求書一括生成
- 外注請求ドラフト自動生成
- 外注専用請求フォーム
- 請求PDF自動保管
- 複数ロール方式
- 経理ロールによる一括承認
- 経理ロールによる一括振込
- 振込結果反映
- freee支払登録
- 監査ログ
- ジョブ化と進捗表示

###対象外または後回し
- 自動組戻し
- 複雑な金額閾値承認
- 複数振込元口座
- 複数銀行口座の高度な配分ルール
- Slack通知
- カスタムワークフローエンジン

---

##用語定義
- Org: 会社 / チーム単位のデータ境界
- Member: Org所属ユーザー
- Role: ユーザーに複数付与できる権限単位
- Client: 請求先
- Content: 1本の動画 / 投稿
- Invoice: クライアント向け請求書
- Vendor: 外注先
- Vendor Invoice: 外注からの請求データ / 請求PDF
- Payout: 支払い予定 / 承認 / 支払済み管理の業務レコード
- Transfer: 実際の送金実行ログ
- Transfer Batch: 一括振込のまとめ単位
- Page: 社内ナレッジページ
- Notification: アプリ内通知
- Audit Log: 監査証跡

---

##ロール / 権限設計
###方針
1ユーザーに複数ロールを付与できる。Discord方式のようにロールを重ねて持てる設計にする。

###システムロール
- owner
- executive_assistant
- member
- accountant

###基本原則
- owner: 組織全体管理
- executive_assistant: 管理補助
- member: 制作メンバー
- accountant: 金銭操作専用ロール

###重要原則
金銭に触れる操作は accountant ロールのみ可能。
owner であっても accountant を持たない場合は、振込実行できない。

###複数ロール例
- owner + accountant
- executive_assistant + accountant
- owner + member

###主要権限一覧
####owner
- 組織設定
- メンバー管理
- ロール付与
- 監査ログ閲覧
- 請求 / 外注 / ページ / 設定の管理

####executive_assistant
- 請求・外注・ページ・設定の補助操作
- ただし金銭実行は accountant が必要

####member
- `/contents` の閲覧 / 編集
- ページ閲覧
- 経理系は閲覧不可または制限閲覧

####accountant
- 外注請求承認
- 口座変更承認
- 一括承認
- 一括振込
- 振込失敗再試行
- freee同期
- 口座管理

###承認設計
2段階承認とするが、同一人物運用も許容する。

- Stage1: 支払バッチ承認
- Stage2: 再認証つき振込実行

---

##認証 / 組織参加
###認証
- Googleログイン必須
- Emailログイン任意

###初回オンボーディング
1. ログイン
2. 表示名入力
3. 3択
   - 個人で使う
   - 新しい組織を作る
   - 既存組織に参加する

###所属複数対応
- ログイン後、複数Orgに所属している場合は Org chooser を表示
- サイドバーから切り替え可能

###参加申請
- ownerメールに対して参加申請
- owner が承認
- ロールを複数付与できる

---

##情報設計 / ルート
- `/` ログイン
- `/onboarding`
- `/orgs`
- `/home`
- `/contents`
- `/billing`
- `/invoices`
- `/vendors`
- `/payouts`
- `/notifications`
- `/settings`
  - `/settings/account`
  - `/settings/org`
  - `/settings/members`
  - `/settings/roles`
  - `/settings/audit`
  - `/settings/export`
  - `/settings/import`
  - `/settings/assets`
  - `/settings/health`
  - `/settings/e2e`
- `/pages/[slug]`
- `/vendor-portal/[token]`

---

##画面別要件

##/home
###目的
全体の状況を一目で把握する。

###表示
- 今月売上
- 今月外注費
- 粗利
- 今日 / 明日の納期数
- 外注未提出件数
- 支払承認待ち件数
- 振込失敗件数
- 主要導線
  - `/contents`
  - `/billing`
  - `/payouts`

---

##/contents
###目的
制作進行の核であり、請求と支払いの元データでもある。

###1行の意味
1行 = 1コンテンツ

###必須列
- client_id
- project_name
- title
- due_client_at
- due_editor_at
- status
- thumbnail_done
- unit_price
- billable_flag
- delivery_month
- links_json

###追加列
- vendor_assignment_summary
- cost_total
- payout_target_flag

###外注原価の元データ
各コンテンツに対して、複数の外注作業割当を持てる。

####作業割当項目
- vendor
- work_type
- quantity
- unit_price
- amount
- payout_target_flag

###ユースケース
- 編集者 1名
- デザイナー 1名
- 台本担当 1名
を1コンテンツに割り当てられる

###派生処理
- クライアント請求は `unit_price` から集計
- 外注請求ドラフトは `content_vendor_assignments` から集計

###主要操作
- テンプレから一括作成
- 外注割当一括設定
- 単価一括反映
- 月次請求対象確認

---

##/billing
###目的
対象月のクライアント請求書をワンボタンで生成する。

###仕様
- delivery_month を選択
- billable_flag = true を抽出
- client ごとにグルーピング
- invoice draft 作成
- PDF生成ジョブ投入
- Storageへ保管

###請求条件初期値
- 締め: 月末
- 発行: 翌月5日まで
- 支払期限: 翌月末
- 税: 当面0

###請求名命名規則
`【御請求書】YYYY-MM_請求先名_請求名`

---

##/invoices
###目的
クライアント請求書と外注請求書の保管・確認導線を強くする。

###表示
- クライアント請求書一覧
- 外注請求書一覧への導線
- PDF保管状態
- 発行日
- 金額
- 対象月

###重要価値
請求書自動保管をデモで強く見せる。

---

##/vendors
###目的
外注マスタ・口座・請求・振込のハブにする。

###表示
- 外注基本情報
- メールアドレス
- デフォルト口座
- 口座変更履歴
- 外注フォームURL
- 今月請求ステータス
- 過去請求履歴
- 過去振込履歴

###主要操作
- 外注追加
- 口座登録
- フォームURL再発行
- 未提出催促
- 口座変更承認

###口座登録方針
- 初期登録時に強い警告を表示
- 口座情報の確認責任を明示
- 画面表示はマスキング
- DB保存は通常保存

---

##/vendor-portal/[token]
###目的
外注本人が今月請求を確認し、問題なければ請求できる専用画面。

###画面特性
- サイドバーなし
- モバイル最適化
- 外注にとってわかりやすいUI

###表示内容
- 今月の請求対象案件一覧
- 各案件の単価
- 合計額
- 登録口座情報
- PDFプレビュー
- 注意事項
- 請求ボタン

###外注の主フロー
1. URLを開く
2. 今月請求対象を確認する
3. 金額と口座を確認する
4. 問題なければ請求ボタンを押す
5. PDFとデータが保存される

###注意文言
- 口座情報を必ず確認してください
- 送信後は経理承認に入ります
- 修正が必要な場合は事前に連絡してください

###口座変更
- 外注本人も変更申請可能
- 変更は即時反映しない
- 経理承認後に有効化する

---

##/payouts
###目的
一括承認・一括振込・失敗確認・freee同期までを1画面で完結させる。

###画面方針
タブ分割よりも、1画面縦構成で流れがわかる設計にする。

###セクション構成
1. 月選択 / サマリー
2. 外注請求提出状況
3. 承認待ち一覧
4. 承認済みバッチ
5. 振込実行状況
6. 失敗一覧
7. freee同期状況
8. 監査ログ導線

###最上部サマリー
- 対象件数
- 合計振込額
- 振込手数料合計
- 未提出件数
- 未承認件数
- 実行済件数
- 失敗件数

###最重要表示
- 合計額
- 口座

###主ボタン
- 外注請求ドラフト生成
- 一括承認
- 振込プレビュー
- 一括振込
- 失敗分再試行
- freee同期

###一括承認
- batch単位で承認
- 画面上は「今月の支払バッチ」を承認対象として扱う
- 内部的には各 payout の状態も更新する

###振込プレビューで弾く条件
- 口座未登録
- 口座変更未承認
- 金額0
- 未提出請求
- 未承認請求
- 重複送金候補
- 前回失敗未解消
- provider障害中

###実行前モーダル
- 合計額を大きく表示
- 振込件数
- 振込日
- 振込元口座
- 振込先件数
- 主要警告

###実行中UI
- 進捗バー
- 完了件数 / 総件数
- 成功件数
- 失敗件数
- webhook待ち / polling中 表示

###失敗時
- 手動再試行のみ
- 失敗理由を即読める
- 組戻し / 取消が必要な場合は「やること」を画面で明示する

---

##/notifications
###MVP
- アプリ内通知のみ

###通知種別
- membership.requested
- membership.approved
- membership.rejected
- vendor_invoice.submitted
- vendor_invoice.approved
- payout.batch_ready
- payout.transfer_succeeded
- payout.transfer_failed
- bank_account.change_requested
- bank_account.change_approved

---

##/settings
###主要メニュー
- account
- org
- members
- roles
- audit
- export
- import
- assets
- health
- e2e

###/settings/roles
- ロール一覧
- システムロール表示
- 将来のカスタムロール追加余地
- ユーザーへの複数付与UI

###/settings/audit
- 承認者
- 実行者
- 実行日時
- 金額
- 対象口座
- 結果
- 失敗理由
を検索・絞り込みできる

---

##Pages
###目的
ナレッジをSaaS内に貯めることで、業務OSとしての依存を作る。

###要件
- サイドバーCTAから新規作成
- リッチテキスト
- 埋め込み
- 画像 / 動画
- 並び替え
- memberは閲覧のみ

---

##データモデル
###設計原則
- 全テーブルに `org_id` を持つ
- RLSでOrg隔離する
- 高リスク操作は actor を必ず残す
- 口座変更や実送金は業務レコードと分離する

###主要テーブル
- organizations
- app_users
- roles
- app_user_roles
- membership_requests
- clients
- contents
- content_vendor_assignments
- invoices
- invoice_lines
- vendors
- vendor_bank_accounts
- vendor_bank_account_change_requests
- vendor_portal_links
- vendor_invoices
- vendor_invoice_lines
- payouts
- transfer_batches
- transfers
- payout_batch_approvals
- pages
- content_templates
- notifications
- audit_logs
- freee_sync_logs
- jobs

---

##推奨DDL
```sql
create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kgi_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  permissions_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.app_user_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (app_user_id, role_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_type text not null default 'corporate',
  billing_email text null,
  billing_address text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  project_name text not null,
  title text not null,
  due_client_at date not null,
  due_editor_at date not null,
  status text not null default 'not_started',
  thumbnail_done boolean not null default false,
  unit_price integer not null default 0,
  billable_flag boolean not null default true,
  delivery_month text not null,
  links_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_vendor_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  work_type text not null,
  quantity numeric not null default 1,
  unit_price integer not null default 0,
  amount integer not null default 0,
  payout_target_flag boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  target_month text not null,
  title text not null default '',
  issue_date date not null default (now()::date),
  due_date date null,
  status text not null default 'draft',
  total_amount integer not null default 0,
  pdf_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null default '',
  quantity integer not null default 1,
  unit_price integer not null default 0,
  amount integer not null default 0,
  project_name text null,
  content_title text null,
  content_id uuid null references public.contents(id) on delete set null
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  bank_name text not null,
  bank_code text null,
  branch_name text not null,
  branch_code text null,
  account_type text not null,
  account_number text not null,
  account_holder_name text not null,
  is_default boolean not null default true,
  is_active boolean not null default true,
  verified_at timestamptz null,
  created_by_user_id uuid null,
  updated_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_bank_account_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  target_account_id uuid null references public.vendor_bank_accounts(id) on delete set null,
  requested_payload jsonb not null,
  status text not null default 'pending',
  requested_by_type text not null,
  requested_by_user_id uuid null,
  approved_by_user_id uuid null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_portal_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  token_hash text not null unique,
  is_active boolean not null default true,
  last_used_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  target_month text not null,
  source text not null default 'auto_draft',
  status text not null default 'draft',
  total_amount integer not null default 0,
  pdf_path text null,
  submitted_by_vendor_at timestamptz null,
  approved_by_user_id uuid null,
  approved_at timestamptz null,
  rejected_reason text null,
  pdf_generated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  vendor_invoice_id uuid not null references public.vendor_invoices(id) on delete cascade,
  description text not null default '',
  quantity integer not null default 1,
  unit_price integer not null default 0,
  amount integer not null default 0,
  content_id uuid null references public.contents(id) on delete set null,
  work_type text null
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  vendor_invoice_id uuid null references public.vendor_invoices(id) on delete set null,
  pay_date date not null,
  amount integer not null default 0,
  status text not null default 'draft',
  approved_at timestamptz null,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transfer_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  target_month text not null,
  total_count integer not null default 0,
  total_amount integer not null default 0,
  status text not null default 'draft',
  provider text null,
  approved_by_user_id uuid null,
  approved_at timestamptz null,
  executed_by_user_id uuid null,
  executed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  transfer_batch_id uuid not null references public.transfer_batches(id) on delete cascade,
  payout_id uuid not null references public.payouts(id) on delete cascade,
  vendor_bank_account_id uuid not null references public.vendor_bank_accounts(id) on delete restrict,
  provider text not null,
  provider_transfer_id text null,
  idempotency_key text not null,
  status text not null default 'queued',
  amount integer not null,
  fee_amount integer not null default 0,
  beneficiary_snapshot jsonb not null default '{}'::jsonb,
  requested_at timestamptz null,
  processed_at timestamptz null,
  failed_at timestamptz null,
  failure_code text null,
  failure_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key)
);

create table if not exists public.payout_batch_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  transfer_batch_id uuid not null references public.transfer_batches(id) on delete cascade,
  stage integer not null,
  actor_user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now(),
  unique (transfer_batch_id, stage, actor_user_id)
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  title text not null,
  icon text null,
  cover_path text null,
  body_json jsonb not null default '{}'::jsonb,
  order_index numeric not null default 0,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.freee_sync_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  direction text not null default 'outbound',
  status text not null default 'pending',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb null,
  external_id text null,
  synced_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

##状態設計
###content status
- not_started
- materials_confirmed
- editing
- internal_revision
- editor_revision
- submitted_to_client
- client_revision
- scheduling
- delivered
- published
- rejected

###vendor invoice status
- draft
- submitted
- approved
- rejected
- payout_generated
- paid
- void

###payout status
- draft
- approval_pending
- approved
- queued
- processing
- paid
- failed
- cancelled
- reversed

###transfer batch status
- draft
- approved
- queued
- processing
- partial_success
- succeeded
- failed
- cancelled

###transfer status
- queued
- processing
- succeeded
- failed
- reversed

---

##RLS方針
###原則
- Org隔離を最優先
- 参照は所属Orgベース
- 高リスク操作は権限関数で判定
- `app_users` の再帰問題を避ける

###推奨ヘルパー
- `my_org_ids()`
- `has_role(p_org_id uuid, p_role_key text)`
- `has_permission(p_org_id uuid, p_permission text)`

###権限例
- accountant がないと `payout execute` 不可
- member は billing / payouts 参照不可または最小表示
- vendor portal はトークン認証で別導線

---

##Storage設計
###バケット
- invoices
- vendor_invoices
- pages
- assets

###パス規約
- `invoices/{org_id}/{target_month}/{invoice_id}.pdf`
- `vendor_invoices/{org_id}/{target_month}/{vendor_invoice_id}.pdf`
- `pages/{org_id}/{page_id}/...`
- `assets/{org_id}/...`

###アクセス
- invoices / vendor_invoices: admin系 + accountant
- pages: member read, admin write

---

##バッチ / ジョブ設計
###対象ジョブ
- invoice_generate
- invoice_pdf_generate
- vendor_invoice_generate
- vendor_invoice_pdf_generate
- payout_batch_create
- transfer_execute
- freee_sync
- assets_copy
- export
- import

###原則
- 300請求 / 250外注支払い規模を前提に同期実行しない
- UIからはジョブ投入し、進捗表示する
- 失敗はログに残し、再試行可能にする

---

##API仕様
###org / onboarding
- `POST /api/orgs/create`
- `GET /api/orgs/mine`
- `POST /api/memberships/request`
- `POST /api/memberships/approve`
- `POST /api/memberships/reject`

###roles
- `GET /api/roles`
- `POST /api/roles`
- `PATCH /api/roles/:id`
- `POST /api/members/:appUserId/roles/attach`
- `POST /api/members/:appUserId/roles/detach`
- `GET /api/members/:appUserId/effective-permissions`

###billing / invoices
- `POST /api/invoices/generate`
- `POST /api/invoices/pdf`
- `GET /api/invoices/status`

###vendor portal
- `POST /api/vendor-portal/request-link`
- `GET /api/vendor-portal/:token/current-invoice`
- `POST /api/vendor-portal/:token/submit`
- `POST /api/vendor-portal/:token/request-bank-account-change`

###vendor invoice
- `POST /api/vendor-invoices/generate-drafts`
- `GET /api/vendor-invoices?target_month=`
- `POST /api/vendor-invoices/:id/approve`
- `POST /api/vendor-invoices/:id/reject`
- `POST /api/vendor-invoices/:id/pdf`

###bank account
- `GET /api/vendor-bank-accounts?vendor_id=`
- `POST /api/vendor-bank-accounts`
- `PATCH /api/vendor-bank-accounts/:id`
- `POST /api/vendor-bank-accounts/change-requests/:id/approve`
- `POST /api/vendor-bank-accounts/change-requests/:id/reject`

###payout / transfer
- `POST /api/payouts/generate`
- `POST /api/payouts/preview`
- `POST /api/payouts/create-batch`
- `POST /api/payout-batches/:id/approve-stage1`
- `POST /api/payout-batches/:id/execute-stage2`
- `GET /api/payout-batches/:id/status`
- `POST /api/transfers/webhook`
- `POST /api/transfers/retry-failed`
- `POST /api/transfers/reverse-guide`

###freee
- `POST /api/freee/connect`
- `POST /api/freee/sync/payout-batch/:id`
- `GET /api/freee/sync/status?entity_type=&entity_id=`

###export / import / assets
- `GET /api/export`
- `POST /api/import/preview`
- `POST /api/import/apply`
- `POST /api/assets/scan`
- `POST /api/assets/copy`
- `POST /api/assets/verify`

---

##外注請求回収仕様
###生成
- 月次で `content_vendor_assignments` を集計
- vendor単位で `vendor_invoice draft` を作成

###外注側確認
- vendor portal で確認
- 問題なければ請求
- PDFと情報が保存される

###経理側確認
- 提出済みを一覧で確認
- 必要に応じて修正
- 承認後に payout を生成

###修正方針
金額ズレは手修正後に承認する。

---

##振込仕様
###前提
- 振込元口座: 1口座
- 振込手数料: 自社負担
- 外注には請求額満額が着金する設計
- 支払日: 翌々月5日
- 実行形式: 一括

###provider方針
接続先は抽象化し、アダプタ方式にする。

候補:
- GMO
- SBI住信ネット
- 三菱UFJ
- 三井住友

###実行前チェック
- accountant ロール保有
- stage1 承認済み
- stage2 再認証成功
- 口座有効
- 金額正常
- 二重送金候補なし
- provider稼働可

###二重送金防止
- provider + idempotency_key を一意制約
- 既に paid / processing の payout は再送禁止
- UIボタン多重押下防止
- バッチ単位の再実行も差分のみ

###結果取得
- webhook と polling の両対応

###失敗時
- 手動再試行
- 管理者通知
- 失敗理由を明示
- 組戻しや取消は案内表示

---

##freee連携
###初期要件
- 本ローンチで実装対象
- 振込結果に応じて freee へ支払登録する

###保持情報
- 接続状態
- 同期対象entity
- request / response
- 外部ID
- 同期日時

###失敗時
- 再同期可能
- audit と sync log の両方に残す

---

##通知設計
###原則
MVPはアプリ内通知のみ。高リスクイベントを逃さない。

###通知対象
- 参加申請
- 外注請求提出
- 口座変更申請
- 口座変更承認
- 承認待ちバッチ
- 振込成功
- 振込失敗
- freee同期失敗

---

##監査ログ
###必須記録項目
- 誰が承認したか
- 誰が実行したか
- いつか
- いくらか
- どの口座か
- 結果
- 失敗理由

###例
- `vendor_invoice.submitted`
- `vendor_invoice.approved`
- `bank_account.change_requested`
- `bank_account.change_approved`
- `payout.batch.approved_stage1`
- `payout.batch.executed_stage2`
- `transfer.succeeded`
- `transfer.failed`
- `freee.sync.succeeded`
- `freee.sync.failed`

---

##UX / UI方針
###重視する感覚
- 迷わない
- 不安にならない
- 金額と口座を最優先で確認できる
- 進捗が見える
- エラー時に何をすべきかすぐわかる

###設計原則
- 1画面で全体の流れが見える
- 重要数値を大きく見せる
- 高リスク操作前に要約を出す
- 実行中は進捗可視化
- 失敗理由は短く明快に出す
- モバイルでも外注フォームは使いやすくする

###Addness風で意識する点
- 中央寄せの視線誘導
- 強いCTA
- 見切れないモーダル
- ライト / ダークどちらでも可読性

---

##非機能要件
###性能
- 月次300請求 / 外注250件で落ちない
- 一括振込進行表示が破綻しない
- 大量PDF生成はジョブ化

###可用性
- provider障害時は実行停止
- 管理者に通知
- 状態不整合を避ける

###セキュリティ
- accountant 限定実行
- 再認証必須
- 口座番号マスキング
- トークンURLは hash 保存
- RLSでOrg隔離

###運用性
- 監査ログ検索可能
- export / import 可能
- 障害時に復旧しやすい

---

##実装順序
###Phase 1
- 複数ロール基盤
- 権限関数 / RLS更新
- `/settings/roles`

###Phase 2
- `content_vendor_assignments`
- `/contents` の外注原価UI
- vendor draft生成

###Phase 3
- vendor portal
- PDF保管
- 口座変更承認

###Phase 4
- `/payouts` 1画面化
- batch 承認
- 振込プレビュー

###Phase 5
- transfer abstraction
- provider adapter
- webhook / polling
- 進捗表示

###Phase 6
- freee同期
- 監査 / E2E / 障害導線強化

---

##E2E観点
###正常系
- owner が org 作成できる
- owner が accountant を付与できる
- member が contents を更新できる
- vendor invoice draft が生成される
- vendor が portal で請求できる
- accountant が一括承認できる
- accountant が再認証後に振込実行できる
- 結果が反映される
- freee同期できる

###異常系
- accountant がないユーザーは実行不可
- 口座未登録時は実行不可
- 口座変更未承認時は実行不可
- duplicate idempotency は拒否
- provider失敗時は failed へ遷移
- freee同期失敗時は再実行可能

---

##既知のリスク
- 銀行API接続先の確定と審査が外部依存
- providerごとの仕様差分吸収が必要
- 同一人物運用だと承認分離は弱いが、再認証で補完する
- 通常保存の口座情報は、将来的に暗号化要件へ発展する可能性あり

---

##最終的な勝ち筋
このSaaSの勝ち筋は、単なる制作管理ツールでも、単なる請求ツールでもなく、

- 制作進行
- クライアント請求
- 外注請求回収
- 証憑保管
- 振込
- freee同期
- ナレッジ蓄積

を全部つなげて、受託会社にとって「これがないと無理」の状態を作ること。

その中心にあるのが、今回追加した「外注請求回収から振込まで1画面で終わる」体験である。

