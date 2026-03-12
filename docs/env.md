# 環境変数・DB

## DBマイグレーション（オンボーディング用）

オンボーディング（表示名入力・組織選択）やメンバー一覧/Pages 機能を使う場合は、Supabase で次のマイグレーションを実行してください。

- **supabase/sql/009_onboarding_multiorg.sql**  
  `user_profiles`（表示名・active_org_id）、`join_requests`、`notifications` などを作成します。  
  事前に 001_schema.sql 等で `organizations` / `app_users` が存在している必要があります。
- **supabase/sql/010_join_request_display_name.sql**  
  `join_requests.requested_display_name`（参加申請時の「この組織内での表示名」）を追加します。  
  Supabase Dashboard → SQL Editor で 009 の後に実行してください。
- **supabase/sql/011_content_templates.sql**  
  `content_templates`（クライアント別コンテンツテンプレート）テーブルと RLS を追加します。  
  /contents の「テンプレから追加」で利用します。
- **supabase/sql/012_organizations_owner_update.sql**  
  組織名の更新を owner のみに制限します。  
  /settings/workspace でワークスペース名を変更する際に必要です。
- **supabase/sql/013_app_users_members_visibility.sql**  
  `app_users` の SELECT ポリシーを「同一 org のメンバー全員が閲覧可」に変更します。  
  /members ページでオーナー以外もメンバー一覧を閲覧できるようにするために必要です。
- **supabase/sql/014_pages.sql**  
  `pages` テーブル（org 内ドキュメント）と RLS を追加します。  
  /pages 機能（マニュアル/メモ/ドキュメント）のために必要です。
- **supabase/sql/007_invoice_pdf_storage.sql**  
  `invoices.pdf_path` と Storage バケット **invoices**（private）を作成します。  
  請求書 PDF の保管に必要です。未実行の場合は Supabase Dashboard → SQL Editor で実行してください。
- **supabase/sql/017_invoices_mvp_issuance.sql**  
  `invoices.total` / `updated_at`、`invoice_lines.created_at` を追加します。  
  /billing 一括生成・請求書発行 MVP に必要です。
- **supabase/sql/020_invoices_pdf_path.sql**  
  `invoices.pdf_path` を追加します（007 未実行で「column invoices.pdf_path does not exist」が出る場合に実行。007 を実行済みなら不要）。
- **supabase/sql/021_invoice_lines_rls_use_helper.sql**  
  `invoice_lines` の RLS を `user_role_in_org` 利用に変更します。billing で「明細の作成に失敗しました: クライアント名」のように出る場合は 018 実行後に本ファイルを実行してください。
- **supabase/sql/022_invoice_lines_project_name_title.sql**  
  `invoice_lines.project_name` と `invoice_lines.title` を追加します。「column invoice_lines_1.project_name does not exist」が出る場合は実行してください。
- **supabase/sql/023_invoices_invoice_name.sql**  
  `invoices.invoice_name` を追加します。「column invoices.invoice_name does not exist」が出る場合は実行してください。
- **supabase/sql/019_vendors_payouts_mvp.sql**  
  `vendors` / `vendor_invoices` / `vendor_invoice_lines` / `content_vendor_assignments` と RLS を追加します。  
  外注支払い（/vendors、/payouts）に必要です。018 の user_role_in_org が定義されている必要があります。

## 環境変数

### 必須（請求書PDF・オンボーディング組織作成・既存組織参加）

- **NEXT_PUBLIC_SUPABASE_URL**  
  Supabase プロジェクトの URL。クライアント・サーバー両方で使用。
- **SUPABASE_SERVICE_ROLE_KEY**  
  Supabase のサービスロールキー。API で DB/Storage を RLS をバイパスして操作するために必要（請求書PDF、組織作成、**既存組織に参加**のオーナー検索など）。  
  `.env.local` に追加し、**NEXT_PUBLIC_ を付けない**（サーバー専用。クライアントに露出しない）。  
  本番ではデプロイ環境のシークレットに設定。  
  **既存組織に参加**で「参加申請は現在利用できません」と出る場合は、このキーが未設定かサーバー未再起動の可能性があります。設定後は `npm run dev` を再起動してください。

### 任意

- **PUPPETEER_EXECUTABLE_PATH**  
  ローカルで PDF 生成に使う Chrome/Chromium の実行ファイルパス。  
  未設定の場合は OS 別の既定パス（Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` 等）を参照し、見つからなければ `@sparticuz/chromium` のバイナリを使用する。
