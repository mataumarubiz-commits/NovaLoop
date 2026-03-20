# Supabase Bootstrap

このリポジトリは、Supabase CLI の migration 管理ではなく、`supabase/sql/*.sql` を順番に適用して環境を作る前提です。

## 1. 新しい Supabase プロジェクトを作る

Supabase Dashboard で新しい project を作成し、次の値を控えます。

- Project URL
- anon key
- service_role key

これらは後で `.env.local` や本番環境変数に入れます。

## 2. SQL を番号順に適用する

Supabase Dashboard -> SQL Editor を開いて、`supabase/sql` のファイルをファイル名順に実行します。

ルール:

- 小さい番号から順に実行する
- 途中を飛ばさない
- エラーが出たら、その時点で止めて原因を確認する

## 3. Storage bucket を確認する

現在の実装では、少なくとも次の bucket を使います。

- `invoices`
- `page-assets`
- `exports`
- `project-assets`

`vault` は過去資料に残っていますが、現行コードの主系統ではありません。

## 4. Google Provider を接続する

Supabase Dashboard -> Authentication -> Providers -> Google で、新しい Google Cloud OAuth の Client ID / Secret を設定します。

あわせて次も確認してください。

- Supabase Auth の Redirect URLs
- Google Cloud OAuth の Authorized redirect URI
- アプリの `NEXT_PUBLIC_APP_URL`

この 3 つが一致していないと、Google ログイン開始や戻り処理で失敗します。

## 5. 最初の owner ユーザーを作る

おすすめ手順:

1. 先に Google ログインで 1 回サインインする
2. Authentication -> Users で `auth.users` の user id を確認する
3. SQL Editor で組織と owner を作る

例:

```sql
insert into organizations (id, name)
values ('<org_uuid>', '<org_name>');

insert into app_users (id, org_id, user_id, role)
values ('<app_user_uuid>', '<org_uuid>', '<auth_user_uuid>', 'owner');

insert into user_profiles (user_id, active_org_id, display_name)
values ('<auth_user_uuid>', '<org_uuid>', '<display_name>')
on conflict (user_id) do update
set active_org_id = excluded.active_org_id,
    display_name = excluded.display_name;

insert into org_settings (org_id, kgi_text, invoice_seq, issuer_name, issuer_address, bank_text)
values ('<org_uuid>', null, 1, null, null, null)
on conflict (org_id) do nothing;
```

値は自分の環境に合わせて置き換えてください。

## 6. 環境変数を設定する

Next.js 側で最低限必要なのは次です。

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

## 7. 最低限の動作確認

次の順で確認すると切り分けしやすいです。

1. `/` で Google ログインできる
2. `/home` に入れる
3. `/invite` の再ログイン導線が動く
4. Vendor portal の再ログイン導線が動く
5. Pages embed の再ログイン導線が動く
6. PDF 生成や asset signed URL が失敗しない

## 8. このリポジトリに無いもの

次のファイルは現在ありません。

- `supabase/config.toml`
- `supabase/migrations`
- `supabase/seed.sql`

そのため、「CLI で migrate / db reset して再現する」運用には、まだ変わっていません。