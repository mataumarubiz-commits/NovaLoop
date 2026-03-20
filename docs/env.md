# Environment Setup

このリポジトリは、接続先の切り替えをコードではなく環境変数で行う前提です。
新しい Supabase や新しい Google Cloud OAuth へ移行するときも、まずは環境変数と Supabase Dashboard 側の設定をそろえます。

## 1. このリポジトリの前提

- `supabase/config.toml` はありません
- `supabase/migrations` はありません
- `supabase/seed.sql` はありません
- DB セットアップは `supabase/sql/*.sql` を番号順に実行する運用です
- Google OAuth のクライアント ID / Secret はアプリコードから直接は読んでいません

つまり、Google ログインの実キーは主に次の 2 か所で管理します。

- Google Cloud Console
- Supabase Dashboard -> Authentication -> Providers -> Google

## 2. アプリで必須の環境変数

### `NEXT_PUBLIC_APP_URL`

アプリ自身の URL です。Google ログインの戻り先生成に使います。

例:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

本番では本番 URL に合わせてください。

### `NEXT_PUBLIC_SUPABASE_URL`

新しい Supabase プロジェクトの URL です。

例:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
```

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`

フロントエンドと通常 API が使う公開キーです。

例:

```env
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

### `SUPABASE_SERVICE_ROLE_KEY`

サーバー側で RLS を回避して処理するためのキーです。
PDF 生成、Storage 操作、エクスポート処理などで使います。

例:

```env
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

注意:

- `NEXT_PUBLIC_` を付けません
- ブラウザに公開しません
- Vercel などの本番環境にも同じ名前で設定します

## 3. 機能によって必要になる追加環境変数

これらは Supabase 切替そのものには必須ではありませんが、既存機能で使っています。

- `PUPPETEER_EXECUTABLE_PATH`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `DISCORD_PUBLIC_KEY`
- `EXTERNAL_AI_SHARED_SECRET`
- `INVOICE_REMINDER_CRON_SECRET`

## 4. Supabase Edge Function で使う値

`supabase/functions/daily_digest/index.ts` では次の値を使います。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

これは Next.js アプリの `.env.local` とは別に、Supabase Dashboard 側の Function secrets へ入れる想定です。

## 5. 現在コードが使っている主な Storage bucket

新しい Supabase 環境では、少なくとも次を確認してください。

- `invoices`
- `page-assets`
- `exports`
- `project-assets`

`vault` は古い説明や一部資料に残っていますが、現在の実装では主系統ではありません。

## 6. SQL の適用方法

このリポジトリは Supabase CLI migration 管理ではありません。
そのため、新しい環境では Supabase Dashboard の SQL Editor で `supabase/sql` のファイルを番号順に適用します。

例:

1. `001_...sql`
2. `002_...sql`
3. `003_...sql`
4. 以降も同様に最後まで

途中の番号を飛ばさないでください。

## 7. Google OAuth の設定場所

このアプリは `GOOGLE_CLIENT_ID` や `GOOGLE_CLIENT_SECRET` を直接読んでいません。
そのため、設定場所は次のとおりです。

1. Google Cloud Console で OAuth Client を作成
2. Supabase Dashboard の Google Provider に Client ID / Secret を設定
3. Supabase Auth の Redirect URLs を設定
4. `.env.local` の `NEXT_PUBLIC_APP_URL` を実際の URL に合わせる

## 8. ローカル起動の基本手順

1. `.env.example` を見ながら `.env.local` を作る
2. 新しい Supabase の URL とキーを入れる
3. `NEXT_PUBLIC_APP_URL=http://localhost:3000` を入れる
4. `npm run dev` を実行する
5. `/` を開いて Google ログインを試す

## 9. よくあるつまずき

### ログイン開始時に失敗する

次を確認してください。

- `NEXT_PUBLIC_APP_URL`
- Supabase Auth の Redirect URLs
- Google Cloud OAuth の Authorized redirect URI

### ログインはできるが API や PDF が失敗する

次を確認してください。

- `SUPABASE_SERVICE_ROLE_KEY`
- 新しい Supabase 側に SQL がすべて適用されているか
- 必要な Storage bucket があるか

### ローカルと本番で動きが違う

多くの場合、原因は環境変数の差です。
`.env.local` と本番環境の設定値が同じ意味になっているか確認してください。