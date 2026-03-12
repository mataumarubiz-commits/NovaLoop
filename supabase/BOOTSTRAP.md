# Supabase Bootstrap

## 1) SQLの適用場所
- Supabase Dashboard → SQL Editor を開く
- 次の順で実行:
  1. `supabase/sql/001_schema.sql`
  2. `supabase/sql/002_rls.sql`
  3. `supabase/sql/003_storage_policies.sql`

## 2) Storage bucket 作成
- Dashboard → Storage → New bucket
- Bucket name: `vault`
- Public: OFF

## 3) 初期データ投入（Service Roleで実行）
Dashboard → SQL Editor で以下を実行。

```sql
-- 1) organizations
insert into organizations (id, name)
values ('<org_uuid>', '<org_name>');

-- 2) app_users (owner)
insert into app_users (id, org_id, user_id, role)
values ('<app_user_uuid>', '<org_uuid>', '<auth_user_uuid>', 'owner');

-- 3) org_settings
insert into org_settings (org_id, kgi_text, invoice_seq, issuer_name, issuer_address, bank_text)
values ('<org_uuid>', null, 1, null, null, null);
```

### auth_user_uuid の取得
- Dashboard → Authentication → Users
- 該当ユーザーの UUID を `auth_user_uuid` に使用

## 4) 動作確認
- `auth_user_uuid` でログイン
- `app_users` に登録されていることを確認