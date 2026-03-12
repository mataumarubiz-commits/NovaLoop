# SNS運用代行向け 業務OS SaaS 設計書 完全版 v2（実装/移行/PMFまで）
最終更新: 2026-03-06

> 目的：このドキュメントだけで、別スレッド/別AI/別開発者へ **“実装できる粒度”** でコンテキストを移行する。  
> 対象：SNS運用代行（ショート動画/投稿）× 受託会社の「制作進行」＋「請求/外注支払い」＋「ナレッジ/ページ」＝業務OS。  
> 技術前提：Next.js（App Router） + Supabase（Postgres/RLS/Storage/Auth） + API Routes/Edge Functions。

---

## 0. 北極星（Why）と成功指標（DoD）
### 0.1 北極星
- **毎日**：/contents が “スプレッドシート以上” に速く・漏れなく回る
- **毎月**：締め（請求/外注支払い/証憑保管）がワンボタンで終わる
- **組織**：招待/参加申請/承認/ロール/通知が自然に回る
- **安心**：監査ログ・バックアップ/復元・資産移行が揃い、移行できる

### 0.2 規模前提（更新）
- 毎月クライアント請求：**300件**
- 毎月外注支払い：**250件**（=外注側の請求/支払い記録の単位）
- 1日：**20本前後**の納期があり得る（= contents行）
- 目標：月次処理（請求/支払い）を “人の手 0〜10分” へ

### 0.3 DoD（「開発いらない、マーケ回す」判定）
- E2E（owner/assistant/member）全PASS
- 新規ユーザーが **初回フローを自走**（個人/新規Org/参加申請→承認→入室）
- 月次：請求300件相当を **バッチ生成→PDF保管→一覧反映** できる（途中で落ちない）
- 外注：250件相当を **回収→承認→支払い記録/CSV** まで詰まらない
- export/import/assets が復旧可能（insert-only）で、監査ログが残る

---

## 1. 用語・概念
- **Org**：データ隔離の最大境界（会社/チーム）
- **Member**：Org所属ユーザー（roleを持つ）
- **Client**：請求先（法人/個人）
- **Content**：1行=1本の動画/投稿（制作進行の最小単位）
- **Invoice（売上）**：クライアント請求書（当面免税）
- **Vendor（外注）**：支払い先（編集者/デザイナー等）
- **Vendor Invoice（外注請求）**：外注側の請求データ/証憑
- **Payout（支払い）**：支払い予定/支払済みの記録
- **Page**：Notion風ページ（社内OS化）
- **Template**：クライアント別の一括追加テンプレ
- **Notification**：アプリ内通知（参加申請/承認/遅延/締め）
- **Export/Import**：DBバックアップ/復元（insert-only）
- **Assets**：Storageファイル（PDF/画像等）移行

---

## 2. ロール/権限（RBAC）
### 2.1 デフォルト（MVP）
- **owner**
- **executive_assistant**
- **member**（当面：閲覧onlyが基本）

### 2.2 権限の原則
- /contents：全員閲覧。編集は段階実装（MVPは全員操作可でも良いが、権限で絞れる設計にする）
- 経理（billing/invoices/vendors/payouts/export/import/assets/audit）：**owner + executive_assistant**
- Pages：memberは閲覧only（MVP）。編集はowner/assistant。

### 2.3 将来（Discord方式）
- custom_roles + permissions_json（例：pages_edit、contents_edit、billing_view、billing_edit 等）
- UIでロール追加・権限割当・ユーザー付与

---

## 3. ユーザーフロー（登録〜日常運用）
### 3.1 認証
- Google（必須）
- Email（任意）

### 3.2 初回オンボーディング（Addness風UI）
**確定フロー**
1) ログイン（Google / Email）  
2) (初回だけ) **表示名入力**（Orgごとに変えたい需要のため “Orgスコープ” で保持できる）  
3) (初回だけ) 3択
- A 個人で使う → 個人用Org自動作成 → owner付与 → /home
- B 新しい組織を作る → org名入力 → org作成 → owner付与 → /home
- C 既存組織に参加する → ownerメール入力 → 参加申請（pending）  
  → ownerが承認 + ロール付与 → 参加者が所属完了 → /home

### 3.3 Org chooser（所属複数の場合）
- ログイン後、所属Orgが複数なら **Org選択画面**（Addness風のUIを踏襲）
- サイドバー上部からいつでも切替

### 3.4 参加申請の通知（アプリ内）
- 参加申請 → ownerの通知センターへ
- ownerが承認/却下（却下理由 optional）
- 承認時にロール付与（MVP：owner/assistant/memberの3択）

---

## 4. 情報設計（Routes / IA）
- **/**：ログイン（サイドバー非表示）
- **/onboarding**：初回（表示名→3択）
- **/orgs**：Org chooser（複数Org時）
- **/home**：ダッシュボード
- **/contents**：制作進行シート
- **/billing**：請求生成（🔒表示あり、ページは403でガード）
- **/invoices**：請求書一覧
- **/vendors**：外注一覧
- **/payouts**：支払い一覧
- **/settings**：設定（アカウント/組織/ロール/移行/監査）
  - /settings/account（表示名、ログアウト等）
  - /settings/org（組織名変更）
  - /settings/members（メンバー管理・申請承認）
  - /settings/roles（将来：カスタムロール）
  - /settings/export
  - /settings/import
  - /settings/assets
  - /settings/audit
  - /settings/health（診断 + smoke）
  - /settings/e2e（E2Eチェックリスト）
- **/pages/[slug]**：Notion風ページ
- **/notifications**：通知センター（受信箱）

### 4.1 レイアウト（AppShell）
- / はサイドバー非表示
- それ以外：左サイドバー + main
- モバイル：ヘッダー（ハンバーガー＋現在ページ）→ドロワー + overlay

### 4.2 サイドバー
- Home / Contents / Billing / Invoices / Vendors / Payouts / Pages / Settings
- Billingは権限なしでも「🔒 Billing」で表示（クリック可、ページ側403）
- 最下部：強いCTA「＋」→ 新規ページ作成モーダル
- Pages一覧：ドラッグ並び替え（order_index更新）

---

## 5. /home（ダッシュボード）
- KGI：テキスト1行（Org設定で自由入力）
- KPIバー（例）
  - 今月売上（請求予定 or 確定）
  - 今月外注費（支払い予定）
  - 粗利（売上-外注費）※受託で赤字は出ない前提だが、見える化はする
- 今日＆明日の先方提出：総数/未完了
- 外注未提出：数
- 先方納期遅れ：数
- 主要導線：/contents /billing /invoices

---

## 6. /contents（制作進行シート：核）
### 6.1 1行=1コンテンツ（確定）
- 動画/投稿など最小単位を1行で管理
- 投稿日は並び替え影響なし（テキスト）

### 6.2 期限（確定）
- due_client_at（先方提出日）：最重要
- due_editor_at（編集者提出日）：`due_client_at - 3日` を自動計算/提案（確定）

### 6.3 ステータス（保存は英語、表示は日本語）
- DB: status = enum文字列（例：not_started 等）
- UI: statusLabels で日本語にマップ
- 「キャンセル」は **没** に名称統一（確定）
- サムネは checkbox（thumbnail_done）で管理（ステータスから分離）

### 6.4 主要列（必須）
- client_id / project_name / title
- due_client_at / due_editor_at
- status / thumbnail_done
- unit_price（単価：行に持つ → 請求へ直結）
- billable_flag（請求対象）
- delivery_month（YYYY-MM：`due_client_at` から算出）
- links_json（限定公開/素材/台本/サムネ/Driveフォルダ等）

### 6.5 集計（KPI）
- due_client_at が今日/明日で未完了の数
- due_editor_at が超過で未提出（外注未提出）
- due_client_at 超過で未完了（納期遅れ）

### 6.6 テンプレ（今すぐ欲しい機能）
- クライアント別テンプレ：1タップで複数行追加
- 例：毎月30本の固定枠を月初に生成、タイトルは連番、期日は週次で自動配置

---

## 7. Billing / Invoices（売上側：請求）
### 7.1 税
- 当面：免税（税計算なし）
- 将来：tax_rate/org設定、インボイス制度に備え拡張可能に

### 7.2 ワンボタン請求（核心）
- 対象月（delivery_month）を選択
- 対象ステータス（例：delivered/published/rejected）かつ billable_flag=true を抽出
- client別にグルーピング → invoice draft 作成
- 明細：数量(=1)・単価・金額・案件名(project_name)・動画タイトル(title)・備考
- 命名規則：`【御請求書】YYYY-MM_請求先名_請求名`（編集可）
- 送付：PDF生成→Storage保管（送付は手動）

### 7.3 支払条件（初期値）
- 締め：月末
- 発行：翌月5日まで（設定可）
- 支払期限：翌月末（設定可）

### 7.4 個人/法人
- clients.client_type = corporate / individual
- 宛名/敬称/住所等を client_type で最小分岐（MVP）

### 7.5 freee同期（設計）
- MVP：CSVエクスポート（freee取込）
- 将来：OAuth + API連携（取引/請求/支払）
  - org_freee_connections（token保存、refresh）
  - mapping（client↔partner、invoice↔deal）
  - 失敗時リトライ/監査ログ

---

## 8. Vendors / Payouts（外注支払い）
### 8.1 方針（確定）
- 外注支払い対象は **クライアントに請求した（or 請求対象になった）コンテンツのみ**
- 支払日：翌々月5日（初期値、設定可）

### 8.2 外注請求の回収（段階）
- 最終形：外注がフォームで入力→請求が自動で集計/保管
- MVP：vendor_invoice を手動登録 or CSV取込 → 承認 → payout生成

### 8.3 証憑管理
- vendor_invoice.pdf_path をStorageに保存
- 月別に自動整理（target_month）

---

## 9. Pages（Notion風ページ：社内OS）
### 9.1 要件（確定）
- サイドバー下部CTA「＋」で新規ページ作成
- リッチテキスト（見出し、太字、文字サイズ）
- 画像/動画/埋め込み（URL embed）
- ページ並び替え（ドラッグ）
- 権限：member閲覧only（当面）

### 9.2 収納形式（推奨）
- editor: TipTap / ProseMirror JSON を pages.body_json に保存（jsonb）
- 検索：title + fulltext（将来）
- order_index（float or int）で並び順

### 9.3 AI（後半タスク）
- いつでも呼べるパネル（Cmd+K）
- ページ編集/要約/テンプレ化/請求文章ドラフト

---

## 10. 通知センター（Notifications）
- 種別
  - membership.requested / approved / rejected
  - contents.editor_due_overdue（外注未提出）
  - contents.client_due_overdue（納期遅れ）
  - billing.month_close_ready（締めの合図）
- 受信箱：未読/既読、フィルタ、対象ページへ遷移
- MVP：アプリ内のみ（メール/Slackは将来）

---

## 11. データモデル（DDL完全版）
> 注意：Supabaseの `auth.users` は外部。ここではアプリ側テーブルを定義。  
> 方針：全テーブルに `org_id uuid not null` を持ち、RLSで隔離。

### 11.1 Extensions
```sql
-- UUID生成
create extension if not exists "pgcrypto";
```


### 11.2 Enums
```sql
do $$ begin
  create type public.client_type as enum ('corporate','individual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_role as enum ('owner','executive_assistant','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_request_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_status as enum ('draft','issued','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vendor_invoice_status as enum ('draft','submitted','approved','paid','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payout_status as enum ('scheduled','paid','void');
exception when duplicate_object then null; end $$;
```


### 11.3 Core tables
```sql
-- 組織
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kgi_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Org所属（本人行は常に読める）
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null, -- references auth.users(id) (Supabase側で存在)
  role public.app_role not null default 'member',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- 参加申請（ownerメール宛）
create table if not exists public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null,
  requester_display_name text not null default '',
  owner_email text not null,
  target_org_id uuid null references public.organizations(id) on delete set null,
  status public.membership_request_status not null default 'pending',
  approved_role public.app_role null,
  decided_by_user_id uuid null,
  decided_at timestamptz null,
  note text null,
  created_at timestamptz not null default now()
);

-- クライアント
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_type public.client_type not null default 'corporate',
  billing_email text null,
  billing_address text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- コンテンツ（1行=1本）
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
  delivery_month text not null, -- 'YYYY-MM'
  links_json jsonb not null default '{{}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 売上請求書
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  target_month text not null, -- 'YYYY-MM'
  title text not null default '',
  issue_date date not null default (now()::date),
  due_date date null,
  status public.invoice_status not null default 'draft',
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

-- 外注
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 外注請求
create table if not exists public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  target_month text not null, -- 'YYYY-MM'
  status public.vendor_invoice_status not null default 'draft',
  total_amount integer not null default 0,
  pdf_path text null,
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
  content_id uuid null references public.contents(id) on delete set null
);

-- 支払い記録
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  vendor_invoice_id uuid null references public.vendor_invoices(id) on delete set null,
  pay_date date not null,
  amount integer not null default 0,
  status public.payout_status not null default 'scheduled',
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notion風ページ
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  title text not null,
  icon text null,
  cover_path text null,
  body_json jsonb not null default '{{}}'::jsonb,
  order_index numeric not null default 0,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

-- コンテンツテンプレ
create table if not exists public.content_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid null references public.clients(id) on delete set null,
  name text not null,
  items_json jsonb not null default '[]'::jsonb, -- array of row templates
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 通知
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null,
  type text not null,
  payload jsonb not null default '{{}}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

-- 監査ログ
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid null,
  action text not null,
  metadata jsonb not null default '{{}}'::jsonb,
  created_at timestamptz not null default now()
);
```


### 11.4 Indexes（規模300/250に必須）
```sql
create index if not exists idx_app_users_user on public.app_users(user_id);
create index if not exists idx_clients_org on public.clients(org_id);
create index if not exists idx_contents_org_due on public.contents(org_id, due_client_at);
create index if not exists idx_contents_org_month_client on public.contents(org_id, delivery_month, client_id);
create index if not exists idx_invoices_org_month on public.invoices(org_id, target_month);
create index if not exists idx_vendor_invoices_org_month on public.vendor_invoices(org_id, target_month);
create index if not exists idx_payouts_org_date on public.payouts(org_id, pay_date);
create index if not exists idx_pages_org_order on public.pages(org_id, order_index);
create index if not exists idx_notifications_recipient on public.notifications(recipient_user_id, read_at);
```


### 11.5 updated_at トリガ（任意）
```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ begin
  create trigger tr_orgs_updated before update on public.organizations
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_app_users_updated before update on public.app_users
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_contents_updated before update on public.contents
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_invoices_updated before update on public.invoices
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_vendor_invoices_updated before update on public.vendor_invoices
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_payouts_updated before update on public.payouts
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger tr_pages_updated before update on public.pages
  for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
```


---

## 12. RLS（Row Level Security）完全版（再帰回避設計）
> 重要：過去に `app_users` のpolicyで **infinite recursion** が発生。  
> 対策：**app_usersは“本人行のみ”** を読み書き可能にし、Org全体操作は API（service role） or security definer関数で行う。

### 12.1 ヘルパー関数（SECURITY DEFINER）
```sql
-- ユーザーが所属するorg_id一覧（RLS回避のため SECURITY DEFINER）
create or replace function public.my_org_ids()
returns table(org_id uuid)
language sql
security definer
set search_path = public
as $$
  select au.org_id
  from public.app_users au
  where au.user_id = auth.uid();
$$;

-- 指定orgのadminか？（owner/assistant）
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users au
    where au.user_id = auth.uid()
      and au.org_id = p_org_id
      and au.role in ('owner','executive_assistant')
  );
$$;
```


### 12.2 RLS有効化
```sql
alter table public.organizations enable row level security;
alter table public.app_users enable row level security;
alter table public.membership_requests enable row level security;
alter table public.clients enable row level security;
alter table public.contents enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_invoices enable row level security;
alter table public.vendor_invoice_lines enable row level security;
alter table public.payouts enable row level security;
alter table public.pages enable row level security;
alter table public.content_templates enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
```


### 12.3 policies（最低限の完全セット）
```sql
-- organizations: 自分が所属するorgだけ読める
drop policy if exists organizations_select on public.organizations;
create policy organizations_select
on public.organizations for select
using (id in (select org_id from public.my_org_ids()));

-- organizations: 名前変更などはadminだけ（owner/assistant）
drop policy if exists organizations_update on public.organizations;
create policy organizations_update
on public.organizations for update
using (public.is_org_admin(id))
with check (public.is_org_admin(id));

-- app_users: 本人行のみselect/update（再帰回避のため簡素に）
drop policy if exists app_users_select_self on public.app_users;
create policy app_users_select_self
on public.app_users for select
using (user_id = auth.uid());

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self
on public.app_users for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- membership_requests: 申請者は自分の申請だけ見れる
drop policy if exists membership_requests_select_self on public.membership_requests;
create policy membership_requests_select_self
on public.membership_requests for select
using (requester_user_id = auth.uid());

-- adminは自Org宛の申請を閲覧（target_org_idが入っている場合）
drop policy if exists membership_requests_select_admin on public.membership_requests;
create policy membership_requests_select_admin
on public.membership_requests for select
using (target_org_id is not null and public.is_org_admin(target_org_id));

-- membership_requests insert: ログインユーザーのみ
drop policy if exists membership_requests_insert on public.membership_requests;
create policy membership_requests_insert
on public.membership_requests for insert
with check (requester_user_id = auth.uid());

-- membership_requests update: adminのみ（承認/却下）
drop policy if exists membership_requests_update_admin on public.membership_requests;
create policy membership_requests_update_admin
on public.membership_requests for update
using (target_org_id is not null and public.is_org_admin(target_org_id))
with check (target_org_id is not null and public.is_org_admin(target_org_id));

-- clients: 所属orgのみ read/write（writeはadmin推奨）
drop policy if exists clients_select on public.clients;
create policy clients_select
on public.clients for select
using (org_id in (select org_id from public.my_org_ids()));

drop policy if exists clients_write_admin on public.clients;
create policy clients_write_admin
on public.clients for insert
with check (public.is_org_admin(org_id));

drop policy if exists clients_update_admin on public.clients;
create policy clients_update_admin
on public.clients for update
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- contents: 所属orgはselect可。編集権限は段階（MVP:全員insert/update可でも良い）
drop policy if exists contents_select on public.contents;
create policy contents_select
on public.contents for select
using (org_id in (select org_id from public.my_org_ids()));

drop policy if exists contents_write on public.contents;
create policy contents_write
on public.contents for insert
with check (org_id in (select org_id from public.my_org_ids()));

drop policy if exists contents_update on public.contents;
create policy contents_update
on public.contents for update
using (org_id in (select org_id from public.my_org_ids()))
with check (org_id in (select org_id from public.my_org_ids()));

-- invoices/billing系: adminのみ
drop policy if exists invoices_select_admin on public.invoices;
create policy invoices_select_admin
on public.invoices for select
using (public.is_org_admin(org_id));

drop policy if exists invoices_write_admin on public.invoices;
create policy invoices_write_admin
on public.invoices for insert
with check (public.is_org_admin(org_id));

drop policy if exists invoices_update_admin on public.invoices;
create policy invoices_update_admin
on public.invoices for update
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

drop policy if exists invoice_lines_select_admin on public.invoice_lines;
create policy invoice_lines_select_admin
on public.invoice_lines for select
using (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_org_admin(i.org_id)));

drop policy if exists invoice_lines_write_admin on public.invoice_lines;
create policy invoice_lines_write_admin
on public.invoice_lines for insert
with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_org_admin(i.org_id)));

-- vendors/payouts: adminのみ
drop policy if exists vendors_select_admin on public.vendors;
create policy vendors_select_admin
on public.vendors for select
using (public.is_org_admin(org_id));

drop policy if exists vendors_write_admin on public.vendors;
create policy vendors_write_admin
on public.vendors for insert
with check (public.is_org_admin(org_id));

drop policy if exists vendor_invoices_select_admin on public.vendor_invoices;
create policy vendor_invoices_select_admin
on public.vendor_invoices for select
using (public.is_org_admin(org_id));

drop policy if exists payouts_select_admin on public.payouts;
create policy payouts_select_admin
on public.payouts for select
using (public.is_org_admin(org_id));

drop policy if exists payouts_write_admin on public.payouts;
create policy payouts_write_admin
on public.payouts for insert
with check (public.is_org_admin(org_id));

-- pages: memberはselectのみ、編集はadmin
drop policy if exists pages_select on public.pages;
create policy pages_select
on public.pages for select
using (org_id in (select org_id from public.my_org_ids()));

drop policy if exists pages_write_admin on public.pages;
create policy pages_write_admin
on public.pages for insert
with check (public.is_org_admin(org_id));

drop policy if exists pages_update_admin on public.pages;
create policy pages_update_admin
on public.pages for update
using (public.is_org_admin(org_id))
with check (public.is_org_admin(org_id));

-- templates: adminのみ
drop policy if exists templates_select_admin on public.content_templates;
create policy templates_select_admin
on public.content_templates for select
using (public.is_org_admin(org_id));

drop policy if exists templates_write_admin on public.content_templates;
create policy templates_write_admin
on public.content_templates for insert
with check (public.is_org_admin(org_id));

-- notifications: recipientのみ閲覧
drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self
on public.notifications for select
using (recipient_user_id = auth.uid());

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self
on public.notifications for update
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

-- audit_logs: adminのみ
drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin
on public.audit_logs for select
using (public.is_org_admin(org_id));
```


---

## 13. Storage（PDF/画像/添付）
### 13.1 バケット
- invoices（売上PDF）
- vendor_invoices（外注PDF）
- pages（ページ画像/カバー）
- assets（汎用）

### 13.2 パス規約（例）
- invoices/{{org_id}}/{{target_month}}/{{invoice_id}}.pdf
- vendor_invoices/{{org_id}}/{{target_month}}/{{vendor_invoice_id}}.pdf
- pages/{{org_id}}/{{page_id}}/...
- assets/{{org_id}}/...

### 13.3 アクセス
- invoices/vendor_invoices：adminのみ read
- pages：member read、admin write
- すべて org_id パスで隔離

---

## 14. バッチ処理（300請求/250外注に必須）
### 14.1 原則
- 生成は **同期ではなくジョブ化**（UIは進捗が見える）
- 失敗はリトライ、ログに残す

### 14.2 ジョブテーブル（推奨）
- jobs(id, org_id, type, status, payload, result, created_at, updated_at)
- type例：invoice_generate / invoice_pdf / vendor_pdf / export / assets_copy

### 14.3 実行方法
- Supabase Edge Functions + Cron
- もしくは Next.js API + 外部worker（後で）

---

## 15. API仕様（要点）
### 15.1 Onboarding / Org
- POST /api/orgs/create (mode=personal|org, org_name, display_name) → org_id
- GET  /api/orgs/mine → org一覧
- POST /api/memberships/request (owner_email, display_name) → request_id
- POST /api/memberships/approve (request_id, role) → app_users insert + notification
- POST /api/memberships/reject (request_id, note)

### 15.2 Billing
- POST /api/invoices/generate (target_month, rule_set) → invoice drafts
- POST /api/invoices/pdf (invoice_ids[]) → jobs enqueue
- GET  /api/invoices/status (job_id)

### 15.3 Vendors/Payouts
- POST /api/vendors/invoices/import (csv) → vendor_invoices
- POST /api/payouts/generate (target_month) → scheduled payouts

### 15.4 Export/Import/Assets
- GET  /api/export
- POST /api/import/preview
- POST /api/import/apply
- POST /api/assets/scan
- POST /api/assets/copy
- POST /api/assets/verify

---

## 16. UI/UX要点（Addness風の“パクる”条件）
- ログイン後の遷移で “一瞬home→戻る” を起こさない（auth状態が確定してからルーティング）
- 入力枠/ボタンを中央に寄せる（視線誘導）
- Closeボタンは見切れない位置（右上の内側）
- 強いCTAは紫系（ライト/ダークとも可読性優先）

---

## 17. PMF & 受託業界スタンダード化（設計に織り込む要件）
### 17.1 Wedge（最初の一撃）
- **制作進行（/contents） + 締め（請求/外注）** が1本化されていることが差別化
- “スプシ＋会計＋証憑＋権限＋移行” を1つにしたもの

### 17.2 Must-haveの積み上げ（依存を作る）
- テンプレ（クライアント別月次生成）
- 遅延検知（先方/外注）→通知
- 月次ワンボタン（請求/支払い）
- Notionページ（社内OS化）
- Export/Import/Assets（移行の安心）
- 監査ログ（B2Bの信頼）

### 17.3 Moat（後発が追いつけない）
- 業界テンプレのマーケット（運用代行の “型” を配布/共有）
- integrations（freee / Drive / Slack）
- ナレッジが溜まるページ + AI → “会社の脳” がここに残る

---

## 18. 既知の落とし穴（運用メモ）
- Windowsの npm 権限/EPERM/EACCES 対策（npm.cmd、キャッシュ）
- app_users RLS再帰は “本人行だけ” に寄せる（この設計で回避）
- 大量PDF生成は同期NG（ジョブ化必須）

---

## 付録A：ステータス英語→日本語（例）
- not_started: 未着手
- materials_confirmed: 素材確認済み
- editing: 編集者編集中
- internal_revision: 内部修正指示中
- editor_revision: 編集者修正中
- submitted_to_client: 先方提出中
- client_revision: 先方修正中
- scheduling: 投稿設定中
- delivered: 納品完了
- published: 公開完了
- rejected: 没

---

## 付録B：デフォルト設定
- 税：0（免税）
- 締め：月末
- 請求発行：翌月5日（設定可）
- 支払期限：翌月末（設定可）
- 外注支払：翌々月5日（設定可）
