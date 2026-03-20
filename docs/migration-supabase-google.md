# Supabase / Google OAuth Migration Runbook

このドキュメントは、旧 Supabase 環境と旧 Google Cloud OAuth から、安全に新環境へ切り替えるための手順書です。

## 0. 先に決めること

最初に、どちらの移行方針かを決めてください。

- A. 新しい Supabase を空で作り、必要な初期データだけ入れて使い始める
- B. 旧 Supabase の既存データも新環境へ移す

今回のリポジトリ整備は A を安全に進めるためのものです。
B は別途データ移行計画が必要です。

## 1. 新しい Supabase プロジェクトを作る

Supabase Dashboard で新しい project を作成し、次を控えます。

- Project URL
- anon key
- service_role key

## 2. `supabase/sql` を番号順に適用する

このリポジトリには `config.toml` や `migrations` がありません。
そのため、Supabase Dashboard の SQL Editor で `supabase/sql/*.sql` を番号順に実行します。

ポイント:

- 必ず小さい番号から順に実行する
- 途中の SQL を飛ばさない
- エラーが出たら、その場で止める

## 3. Storage bucket を確認する

現在の実装で重要なのは次です。

- `invoices`
- `page-assets`
- `exports`
- `project-assets`

## 4. 新しい Google Cloud OAuth Client を作る

Google Cloud Console で新しい OAuth Client を作成します。

確認ポイント:

- 公開 URL が本番ドメインと一致しているか
- ローカル確認をするなら `http://localhost:3000` も考慮するか
- Authorized redirect URI が Supabase の callback と一致しているか

## 5. Supabase Auth に Google Provider を設定する

Supabase Dashboard -> Authentication -> Providers -> Google で、Google Cloud で作った Client ID / Secret を設定します。

さらに次を設定します。

- Site URL
- Redirect URLs

## 6. アプリの環境変数を差し替える

ローカルや本番環境で、次の値を新しい project 用に更新します。

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

## 7. 最初の owner を作る

おすすめ手順:

1. 新 Google ログインで 1 回サインインする
2. Supabase Authentication の Users で `auth.users.id` を確認する
3. `organizations`, `app_users`, `user_profiles`, `org_settings` を投入する

## 8. ローカル確認

切替後は最低でも次を確認してください。

1. `/` で Google ログイン開始ができる
2. ログイン後に `/home` へ入れる
3. `/invite` からの再ログインが戻ってくる
4. Vendor portal の再ログインが戻ってくる
5. Pages embed の再ログインが戻ってくる
6. 請求 PDF や signed URL が失敗しない

## 9. 本番切替の順番

おすすめ順:

1. 新 Supabase を作る
2. SQL を全部入れる
3. Google Provider をつなぐ
4. ステージングかローカルで確認する
5. 本番環境変数を差し替える
6. 本番ログイン確認をする
7. 旧環境の停止判断をする

## 10. 今回わざとやらないこと

破壊的変更を避けるため、今回は次を含めません。

- テーブル名変更
- bucket 名変更
- Supabase CLI migration 方式への全面移行
- 旧データの自動移行スクリプト作成
- Google ログイン実装の全面書き換え

## 11. つまずいたときの確認順

### Google ログイン開始で失敗する

次を確認します。

- `NEXT_PUBLIC_APP_URL`
- Supabase Auth の Site URL / Redirect URLs
- Google Cloud OAuth の Authorized redirect URI

### ログイン後の画面で API が落ちる

次を確認します。

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- SQL がすべて適用済みか

### PDF やファイル系だけ失敗する

次を確認します。

- service role key
- Storage bucket
- Storage policy