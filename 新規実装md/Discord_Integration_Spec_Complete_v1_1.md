# Discord連携 実装仕様書 完成版 v1.1

最終更新: 2026-04-04  
対象: SNS運用代行向け 業務OS SaaS  
前提技術: Next.js App Router + Supabase(Postgres/RLS/Auth/Storage) + API Routes/Edge Functions  
ステータス: **この文書を正として実装してよい**

---

## 目的

Discordを**管理者向けの通知・検索・案件追加の操作UI**として実装し、既存SaaSの `/contents`・通知センター・監査ログと整合した形で運用できるようにする。

この仕様書は、過去の会話・設計メモ・ヒアリング回答の曖昧さを潰し、**実装時に迷わないこと**を最優先に再構成している。  
特に以下を解消済みとする。

- 1 Org = 1 Discordサーバー
- 1 Org = 1 固定チャンネル
- Discordは Slack の代替として使う
- 金額は Discord に表示しない
- Discordロールとアプリロールは同期しない
- MVPでは Discordユーザーとアプリユーザーを恒久紐づけしない
- その代わり、**接続チャンネル自体を admin-only のプライベートチャンネルにする**
- `/info` `/add` `/audit` は**接続済みの1チャンネルでのみ有効**
- ボタン付きUIは使うが、MVPのボタンは **Link Button のみ** に限定する
- 変化系コマンドは `/add` のみに限定し、承認・請求・支払いはMVPから外す

---

## この仕様書の優先順位

競合や過去メモに別記述があっても、Discord実装に関しては**この文書を優先**する。  
ただし、既存の基盤方針は継承する。

継承する方針:
- `/contents` が制作進行の核
- 通知は遅延検知に直結させる
- 経理は owner / executive_assistant のみ
- 監査ログは必須
- 大量処理は同期ではなくジョブ化
- Supabase RLS の再帰問題を避ける

---

## スコープ

## MVPに入れる

1. Discord App / Bot 導入
2. 1 Org = 1 Discordサーバー接続
3. 1 Org = 1 固定チャンネル接続
4. 即時通知
5. 朝夕サマリ通知
6. `/info` で案件・ページ検索
7. `/add` で新規案件追加
8. `/audit` で最近の監査ログ参照
9. deep link で SaaS 対象画面へ遷移
10. Discord経由操作の監査ログ保存
11. 接続テスト / 送信失敗ログ / 再接続導線

## MVPでやらない

1. 参加申請の承認 / 却下
2. 請求生成
3. 支払い生成
4. 金額表示
5. Discordロール同期
6. 個人DM通知
7. 複数チャンネル振り分け
8. Discordユーザーとアプリユーザーの恒久紐づけ
9. 自然文だけでの完全自動登録
10. クライアント自動新規作成

---

## 固定前提

## 組織とチャンネル

- 1 Org = 1 Discordサーバー
- 1 Org = 1 固定チャンネル
- そのチャンネルは**admin-only のプライベートチャンネル**であること
- コマンドはそのチャンネルでのみ使用可
- 他チャンネルで使われた場合はエラー返却する

### 理由
MVPでは Discordユーザーとアプリユーザーを紐づけないため、**チャンネルのアクセス制御をそのままアプリ権限境界として使う**必要がある。  
このため、公開チャンネルで `/add` や `/audit` を許可してはいけない。

## 権限

- アプリ内権限を正本にする
- Discordロールは参照しない
- ただし MVPでは個人紐づけしないため、Discord上では**接続チャンネルへの参加可否**が実質の利用境界になる
- 経理系データは Discord に出さない
- `/audit` は owner / executive_assistant 想定のため、接続チャンネルは原則その2ロールが見る運用とする
- `member` が Discord上で使うのは将来拡張

## 表示制限

Discordに表示してよいもの:
- タイトル
- 締切日
- クライアント名
- 案件名
- ステータス
- URL
- 件数
- 監査ログの操作名 / 日時 / 対象ID

Discordに表示してはいけないもの:
- 単価
- 請求額
- 支払額
- PDFパス
- 内部メモ全文
- billing / invoices / vendors / payouts の金額系情報

---

## 実装方式

## 技術方針

Discord連携は **HTTP Interaction Endpoint + Bot + Application Commands** で実装する。  
Gateway はMVPでは不要。HTTP受信のみで足りる。

### 理由
- Slash command / modal / button に必要な要素を HTTP で完結できる
- Next.js API Route で受けやすい
- 常時接続の gateway 運用を避けられる
- 署名検証・監査ログ・API統合が単純

## 応答方針

- Interaction は**必ず3秒以内に初回応答**
- 重い処理は `defer` して follow-up
- `/info` は検索件数が多いとき defer
- `/add` は保存前に defer してよい
- `/audit` は直近5件程度なら即時でもよいが、MVPでは統一して defer 可

## コマンド登録方針

- 開発環境: **guild command**
- 本番環境: **guild command のまま開始**
- 安定後に global command へ移行可
- コマンド変更が多い開発初期に global command を使わない

### 理由
guild command のほうが反映が速く、開発中の事故が少ない。  
global command は本番安定後に切り替える。

---

## アーキテクチャ

```text
Discord User
  ↓ slash command / modal submit
Discord
  ↓ HTTPS interaction
Next.js API Route (/api/integrations/discord/interactions)
  ↓ signature verify
Command Router
  ↓
Service Layer
  ├─ Supabase (service role)
  ├─ LLM summary layer (/info の要約のみ)
  ├─ Audit log writer
  └─ Discord REST follow-up sender
```

## 重要な原則

Discordからのリクエストは**外部サーバーからの署名付きWebhook**であり、Supabase の `auth.uid()` は使えない。  
したがって Discord連携エンドポイントでは、**anon key + RLS に依存してはならない**。

必ず以下で実装すること。

1. Next.js サーバー側で署名検証
2. Org 接続情報を特定
3. 接続チャンネル一致を確認
4. 必要ならアプリ内ロール制約を**サーバー側ロジックで判定**
5. Supabase には **service role** でアクセス
6. 監査ログを書き込む
7. Discordへ応答する

---

## Open Questionsを潰した決定事項

## 1. 1チャンネル固定と経理/メンバー分離の衝突

元要望では「通知先は1チャンネル固定」と「メンバー向けと経理向けを分けたい」が同時に存在した。  
MVPでは衝突を避けるため、**admin-only の1チャンネル固定**とする。  
つまり最初は `#経理` でも `#運用管理` でもよいが、**owner / executive_assistant のみが見られる前提**で使う。

## 2. Discordユーザー紐づけ不要とメール一致の衝突

元要望では「恒久紐づけは不要寄り」だが「メール一致」が候補に挙がっていた。  
MVPでは**ユーザー紐づけを実装しない**。  
Discordの email は Bot install だけでは取得できず、別途 User OAuth2 が必要になるため、ここを入れると実装が重くなる。

### 将来
将来ユーザー紐づけが必要になったら、別機能として「Discordアカウント接続」を追加する。  
そのときのみ `identify` + `email` を使う。

## 3. ボタン付きUIの扱い

MVPでは**Link Button のみ**使う。  
カスタムボタンで状態変更はしない。

### 理由
- 余分な interaction ハンドリングを増やさない
- 誤操作リスクを減らす
- deep link 需要を満たせる
- ボタン付きUIの要望にも応えられる

---

## Discordアプリ設定

## 必須設定

- App 作成
- Bot 有効化
- Interactions Endpoint URL 設定
- OAuth2 Redirect URL 設定
- Install Link 設定

## 推奨 OAuth2 scope

- `bot`
- `applications.commands`

## Bot権限の最小セット

- View Channel
- Send Messages
- Embed Links
- Read Message History

`Manage Messages` や `Manage Channels` は不要。  
MVPではメッセージ削除・チャンネル作成・ロール操作をしない。

## 環境変数

```env
DISCORD_APP_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
APP_BASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

### 注意
- `DISCORD_BOT_TOKEN` は**絶対にクライアントへ露出しない**
- `SUPABASE_SERVICE_ROLE_KEY` は**Discord API Route 内のみ**で使う
- client component に流してはいけない

---

## データモデル変更

## 追加テーブル

```sql
create table if not exists public.org_discord_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  guild_id text not null,
  guild_name text not null default '',
  channel_id text not null,
  channel_name text not null default '',
  installed_by_user_id uuid not null,
  commands_enabled boolean not null default true,
  immediate_notifications_enabled boolean not null default true,
  morning_summary_enabled boolean not null default true,
  evening_summary_enabled boolean not null default true,
  incident_notifications_enabled boolean not null default true,
  status text not null default 'active', -- active / error / revoked
  last_healthcheck_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id),
  unique (guild_id)
);

create table if not exists public.discord_notification_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  enabled boolean not null default true,
  delivery_mode text not null default 'both', -- immediate / summary / both
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, event_type)
);

create table if not exists public.discord_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid null references public.notifications(id) on delete set null,
  event_type text not null,
  dedupe_key text not null,
  channel_id text not null,
  discord_message_id text null,
  status text not null default 'queued', -- queued / sent / failed / skipped
  error text null,
  created_at timestamptz not null default now(),
  unique (org_id, event_type, dedupe_key)
);

create table if not exists public.discord_command_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  interaction_id text not null unique,
  discord_guild_id text not null,
  discord_channel_id text not null,
  discord_user_id text not null,
  app_user_id uuid null,
  command_name text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  status text not null default 'success', -- success / failed / denied / duplicate
  created_at timestamptz not null default now()
);

create index if not exists idx_org_discord_connections_org on public.org_discord_connections(org_id);
create index if not exists idx_discord_delivery_logs_org_created on public.discord_delivery_logs(org_id, created_at desc);
create index if not exists idx_discord_command_logs_org_created on public.discord_command_logs(org_id, created_at desc);
```

## 既存テーブルの扱い

### `contents`
`/add` で insert する項目は以下に固定する。

- `org_id`: 接続Org
- `client_id`: 既存クライアントを解決
- `project_name`: 入力値
- `title`: 入力値
- `due_client_at`: 入力値
- `due_editor_at`: 入力値 or `due_client_at - 3日`
- `status`: `'not_started'`
- `thumbnail_done`: `false`
- `unit_price`: 入力値 or `0`
- `billable_flag`: `true`
- `delivery_month`: `YYYY-MM(due_client_at)`
- `links_json`: `'{}'::jsonb`

### `audit_logs`
Discord由来の操作は `metadata.source = "discord"` を必須にする。

例:
```json
{
  "source": "discord",
  "command_name": "add",
  "interaction_id": "1234567890",
  "discord_user_id": "0987654321",
  "discord_channel_id": "1122334455"
}
```

---

## DBレベルの注意点

## 1. idempotency を必ず入れる

### `/add` の重複登録対策
Discord interaction の再送やタイムアウト再試行で、同じ案件が二重登録されるのが最悪。  
そのため以下を必須とする。

- `discord_command_logs.interaction_id` に `unique`
- `/add` 実行前にその `interaction_id` が存在するか確認
- 存在したら **duplicate として結果再返却**する
- 新規 insert は一度だけ

## 2. delivery log の重複通知対策

通知の再送条件は「状態変化があった時だけ」。  
そのため `dedupe_key` を設計する。

例:
- `contents.editor_due_overdue:{content_id}:{status}:{due_editor_at}`
- `contents.client_due_overdue:{content_id}:{status}:{due_client_at}`
- `system.incident:{incident_id}:{incident_state}`

同じ `dedupe_key` は送らない。  
状態変化で `dedupe_key` が変わったら送る。

## 3. updated_at trigger

追加4テーブルにも既存 `set_updated_at()` trigger を付けること。

---

## API仕様

## 共通原則

- すべて `application/json`
- 文字コード UTF-8
- 日付は `YYYY-MM-DD`
- 時刻は ISO 8601
- エラー時は `code`, `message`, `details` を返す
- Discord interaction の初回応答と内部APIは分離してよい

---

## 1. Install Callback

### `GET /api/integrations/discord/install/callback`

### 目的
Discord App インストール後に SaaS 側へ戻り、Org に接続を保存する。

### 入力
Query:
- `code`
- `state`

### state に含めるもの
- `org_id`
- `installed_by_user_id`
- `nonce`
- `expires_at`

### 処理
1. state 検証
2. code を access token に交換
3. guild / installer 情報取得
4. 接続候補チャンネルを取得
5. 設定画面へリダイレクト

### 注意
チャンネル選択は callback 完了後、**SaaS設定画面で確定**させる。  
callback 時点では guild 接続まででよい。

---

## 2. Interaction Endpoint

### `POST /api/integrations/discord/interactions`

### 目的
Discord からの slash command / modal submit を受信する。

### 必須処理
1. `X-Signature-Ed25519` 検証
2. `X-Signature-Timestamp` 検証
3. `PING` に `PONG`
4. command name 判定
5. 3秒以内に応答
6. 重い処理は deferred response

### 禁止事項
- 署名検証前に payload を信用しない
- anon key で Supabase に触らない
- 直接クライアント側コードを呼ばない

### 返却例
```json
{
  "type": 5
}
```

`type: 5` は deferred channel message with source として扱う。

---

## 3. `/info` 処理API

### `POST /api/integrations/discord/commands/info`

### request
```json
{
  "org_id": "uuid",
  "interaction_id": "text",
  "discord_user_id": "text",
  "discord_guild_id": "text",
  "discord_channel_id": "text",
  "query": "ABC社の案件状況"
}
```

### 処理
1. guild / channel の一致確認
2. commands_enabled 確認
3. query の空判定
4. `contents`, `clients`, `pages` を検索
5. 最大5件取得
6. 必要なら LLM で**要約のみ**
7. 金額系をマスク
8. link button を付けて返却
9. 監査ログ保存

### 検索順
1. `contents.title`
2. `contents.project_name`
3. `clients.name`
4. `pages.title`
5. `pages.body_json` の全文検索（余力があれば）

### LLM利用ルール
- 取得した行だけを要約する
- 未取得情報を推測しない
- 金額・支払い・請求は含めない
- LLMが失敗したら**非LLMの定型返却にフォールバック**

### response
```json
{
  "summary": "案件情報です",
  "items": [
    {
      "type": "content",
      "id": "uuid",
      "title": "4月訴求ショート3本目",
      "client_name": "ABC株式会社",
      "project_name": "春商戦ショート",
      "due_client_at": "2026-04-08",
      "status_label": "編集者編集中",
      "app_url": "https://app.example.com/contents/uuid"
    }
  ]
}
```

---

## 4. `/add` 処理API

### `POST /api/integrations/discord/commands/add`

### request
```json
{
  "org_id": "uuid",
  "interaction_id": "text",
  "discord_user_id": "text",
  "discord_guild_id": "text",
  "discord_channel_id": "text",
  "client_name": "ABC株式会社",
  "project_name": "春商戦ショート",
  "title": "4月訴求ショート3本目",
  "due_client_at": "2026-04-08",
  "due_editor_at": null,
  "unit_price": 30000,
  "note": "初稿優先"
}
```

### 処理
1. guild / channel の一致確認
2. interaction_id 重複確認
3. 必須項目バリデーション
4. クライアント解決
5. `due_editor_at` 補完
6. content insert
7. audit log insert
8. command log insert
9. link button 付きで返却

### 必須項目
- `client_name`
- `project_name`
- `title`
- `due_client_at`

### バリデーション
- `due_client_at` は過去日でも登録可。ただし warning を出す
- `due_editor_at` は `due_client_at` より後ろならエラー
- `unit_price` は 0 以上整数
- `title` は trim 後 1文字以上

### クライアント解決ルール
1. 完全一致
2. 正規化一致（全角半角、前後空白、大小文字、株式会社表記ゆれなど）
3. 部分一致候補が複数 → **エラー返却 + 候補提示**
4. 見つからない → **エラー返却 + SaaSのクライアント作成URL案内**

### 重要
MVPでは**新規 client 自動作成はしない**。  
理由は typo による重複 client 作成事故を避けるため。

### response
```json
{
  "content_id": "uuid",
  "title": "4月訴求ショート3本目",
  "due_client_at": "2026-04-08",
  "due_editor_at": "2026-04-05",
  "app_url": "https://app.example.com/contents/uuid"
}
```

---

## 5. `/audit` 処理API

### `POST /api/integrations/discord/commands/audit`

### request
```json
{
  "org_id": "uuid",
  "interaction_id": "text",
  "discord_user_id": "text",
  "discord_guild_id": "text",
  "discord_channel_id": "text",
  "query": "今日の案件追加",
  "limit": 5
}
```

### 処理
1. guild / channel 一致確認
2. limit を 1〜10 に正規化
3. `audit_logs` を検索
4. `source=discord` 優先
5. 最新順で返却
6. command log 保存

### response
```json
{
  "items": [
    {
      "action": "discord.add.created",
      "created_at": "2026-04-04T10:10:00+09:00",
      "target_id": "content_uuid",
      "summary": "案件が追加されました",
      "app_url": "https://app.example.com/contents/content_uuid"
    }
  ]
}
```

---

## 6. 通知送信API

### `POST /api/integrations/discord/notify`

内部ジョブ用。

### request
```json
{
  "org_id": "uuid",
  "event_type": "contents.client_due_overdue",
  "dedupe_key": "contents.client_due_overdue:content_uuid:editing:2026-04-08",
  "payload": {
    "title": "4月訴求ショート3本目",
    "due_client_at": "2026-04-08",
    "app_url": "https://app.example.com/contents/uuid"
  }
}
```

### 処理
1. 接続状態確認
2. event rule 確認
3. dedupe_key 重複確認
4. メッセージ送信
5. delivery log 保存
6. 失敗時 retry enqueue

---

## 7. サマリ送信API

### `POST /api/integrations/discord/summary`

内部ジョブ用。朝夕に実行。

### request
```json
{
  "org_id": "uuid",
  "summary_type": "morning"
}
```

### 集計項目
- 外注未提出件数
- 先方納期遅れ件数
- 今日締切件数
- 明日締切件数
- 障害件数

---

## 8. Health API

### `GET /api/integrations/discord/health?org_id=...`

### response
```json
{
  "status": "ok",
  "guild_connected": true,
  "channel_resolvable": true,
  "bot_can_send": true,
  "last_error": null
}
```

---

## Slash Command定義

## コマンド一覧

### `/info`
- 目的: 案件 / クライアント / ページ検索
- option:
  - `query` string required

### `/add`
- 目的: 新規案件追加
- option:
  - なし
- 実際の入力は modal で受ける

### `/audit`
- 目的: 最近の監査ログ確認
- option:
  - `query` string optional
  - `limit` integer optional

## Modal定義

### `/add` modal

- `client_name` short text required
- `project_name` short text required
- `title` paragraph text required
- `due_client_at` short text required
- `due_editor_at` short text optional
- `unit_price` short text optional
- `note` paragraph text optional

### 日付入力仕様
MVPでは modal に date picker は使わず、`YYYY-MM-DD` の文字列入力で統一する。  
サーバー側で厳密 parse する。

---

## メッセージUI仕様

## 基本方針

- Discord上の見た目は **Embed + Link Button**
- カスタムボタンによる状態変更はしない
- コマンド返答は原則 ephemeral
- 通知は通常メッセージ
- deep link は毎回付ける

## `/info` 返答

### 表示項目
- タイトル
- クライアント
- 案件名
- 締切日
- ステータス
- 1件目の Link Button `詳細を開く`

## `/add` 返答

### 表示項目
- 追加完了
- タイトル
- 先方締切日
- 編集者締切日
- Link Button `案件を開く`

## `/audit` 返答

### 表示項目
- action
- 実行日時
- target id
- Link Button `対象を開く`

## 通知メッセージ

### 外注未提出
```text
⚠️ 外注未提出があります

タイトル: {title}
締切日: {due_editor_at}

状態が更新されたため通知しています。
```

### 先方納期遅れ
```text
🚨 先方納期遅れがあります

タイトル: {title}
締切日: {due_client_at}

状態が更新されたため通知しています。
```

### 障害通知
```text
🔥 障害を検知しました

内容: {incident_title}
発生時刻: {occurred_at}
影響: {impact_summary}
```

### 朝夕サマリ
```text
📋 進行サマリ

外注未提出: {editor_overdue_count}件
先方納期遅れ: {client_overdue_count}件
今日締切: {today_due_count}件
明日締切: {tomorrow_due_count}件
障害中: {incident_count}件
```

---

## 認可仕様

## MVPでの認可境界

MVPでは**接続チャンネルに入れる人 = Discord操作を使える人**とする。  
したがって、接続チャンネルは必ず private channel とし、owner / executive_assistant 以外を入れない運用にする。

## サーバー側認可

以下をすべて満たした場合のみ処理続行:

1. `guild_id` が接続済み guild と一致
2. `channel_id` が接続済み channel と一致
3. `org_discord_connections.status = active`
4. `commands_enabled = true`

## 将来の強化
本当にユーザー単位の権限を効かせたい場合のみ、別機能で Discord account linking を入れる。

---

## エラー仕様

## 共通エラー形式

```json
{
  "code": "CLIENT_NOT_FOUND",
  "message": "既存クライアントが見つかりません",
  "details": {
    "client_name": "ABC"
  }
}
```

## エラーコード一覧

### 接続系
- `DISCORD_SIGNATURE_INVALID`
- `DISCORD_CONNECTION_NOT_FOUND`
- `DISCORD_GUILD_MISMATCH`
- `DISCORD_CHANNEL_MISMATCH`
- `DISCORD_COMMANDS_DISABLED`
- `DISCORD_BOT_SEND_FAILED`

### `/info`
- `QUERY_REQUIRED`
- `NO_RESULTS_FOUND`

### `/add`
- `VALIDATION_ERROR`
- `CLIENT_NOT_FOUND`
- `CLIENT_AMBIGUOUS`
- `DATE_PARSE_ERROR`
- `DUE_EDITOR_AFTER_DUE_CLIENT`
- `DUPLICATE_INTERACTION`
- `CONTENT_CREATE_FAILED`

### `/audit`
- `AUDIT_ACCESS_DENIED`
- `AUDIT_NO_RESULTS`

## Discord側の見せ方

### 他チャンネルで使ったとき
```text
このコマンドは設定済みの管理チャンネルでのみ使えます。
```

### クライアントが見つからないとき
```text
既存クライアントが見つかりませんでした。
SaaS側でクライアントを作成してから再実行してください。
```

### 候補が複数あるとき
```text
クライアント候補が複数あります。
候補:
- ABC株式会社
- ABCホールディングス

SaaS側で正式名称を確認して再実行してください。
```

---

## 通知設計

## イベント一覧

### 即時通知
- `contents.editor_due_overdue`
- `contents.client_due_overdue`
- `system.incident`

### 定期サマリ
- `summary.morning`
- `summary.evening`

### 将来候補
- `membership.requested`
- `billing.month_close_ready`

## 判定ロジック

### 外注未提出
- `due_editor_at < today`
- `status` が未完了群
- dedupe_key 変化時のみ送信

### 先方納期遅れ
- `due_client_at < today`
- `status` が未完了群
- dedupe_key 変化時のみ送信

### 未完了群
MVPでは次を未完了扱いにする。

- `not_started`
- `materials_confirmed`
- `editing`
- `internal_revision`
- `editor_revision`
- `submitted_to_client`
- `client_revision`
- `scheduling`

次は完了扱い:
- `delivered`
- `published`
- `rejected`

---

## `/info` の検索仕様

## MVP検索対象
- `contents`
- `clients`
- `pages`

## MVP検索方法
まずは deterministic retrieval を優先する。

1. Postgres `ILIKE`
2. 必要なら trigram / full-text search
3. ヒットした結果を整形
4. 要約だけ LLM にかける

## やってはいけないこと
- 取得していない請求情報を推測して返す
- LLMだけで回答を生成する
- 金額系テーブルを混ぜる
- 0件なのに「たぶんこれです」と返す

## 0件時
0件なら正直に 0件返却する。  
加えて:
- `/contents` の deep link
- 検索語を変える案内
を返す。

---

## `/add` の登録仕様

## 入力補完

### `due_editor_at`
未入力なら `due_client_at - 3日`

### `unit_price`
未入力なら `0`

### `note`
未入力なら `null`

## 追加時の既定値

- `status = not_started`
- `thumbnail_done = false`
- `billable_flag = true`
- `links_json = {}`

## 自動生成
- `delivery_month = YYYY-MM(due_client_at)`

## 追加後の監査ログ

```json
{
  "action": "discord.add.created",
  "metadata": {
    "source": "discord",
    "interaction_id": "123",
    "discord_user_id": "456",
    "discord_channel_id": "789",
    "content_id": "uuid",
    "client_id": "uuid",
    "auto_filled": {
      "due_editor_at": true,
      "unit_price": false
    }
  }
}
```

---

## `/audit` の検索仕様

## 対象
- `audit_logs` のみ
- 直近 30日を初期対象
- `limit` default 5 max 10

## 並び順
- `created_at desc`

## 表示内容
- action
- created_at
- summary
- target_id
- URL

## マスク
- 金額
- 秘匿メタデータ全文
- service token 系情報

---

## RLS / Supabase 実装方針

## 絶対ルール

Discord interaction から実行される処理は**backend service layer**で完結させる。  
Supabase RLS を Discord request に直接使わない。

## 推奨
- `lib/discord/verify.ts`
- `lib/discord/router.ts`
- `lib/discord/respond.ts`
- `lib/discord/permissions.ts`
- `lib/discord/embeds.ts`
- `lib/discord/dedupe.ts`
- `lib/discord/client-resolver.ts`

## service role を使う場面
- org 接続情報取得
- content insert
- audit log insert
- notifications / delivery logs insert
- command logs insert

## 通常の RLS を使う場面
- SaaS画面からの通常操作のみ

---

## 実装ディレクトリ案

```text
app/
  api/
    integrations/
      discord/
        install/
          callback/route.ts
        interactions/route.ts
        notify/route.ts
        summary/route.ts
        health/route.ts

lib/
  discord/
    verify.ts
    install.ts
    commands/
      info.ts
      add.ts
      audit.ts
    render/
      embeds.ts
      buttons.ts
      messages.ts
    storage/
      connections.ts
      command-logs.ts
      delivery-logs.ts
    validators/
      add.ts
      info.ts
      audit.ts
    utils/
      dedupe.ts
      client-normalize.ts
      dates.ts

app/
  settings/
    integrations/
      discord/
        page.tsx
```

---

## 管理画面仕様

## ルート
`/settings/integrations/discord`

## 表示項目
- 接続状態
- 接続済みサーバー名
- 接続済みチャンネル名
- インストール実行者
- 即時通知 on/off
- 朝サマリ on/off
- 夕サマリ on/off
- 障害通知 on/off
- `/info` on/off
- `/add` on/off
- `/audit` on/off
- 接続テスト
- 最終送信結果
- 最終エラー
- Bot再招待
- 連携解除

## 操作
- Discordに接続
- チャンネルを確定
- ON/OFF切替
- 接続テスト
- 解除

## 接続テスト内容
1. guild 取得
2. channel 存在確認
3. bot 送信確認
4. success/fail 表示

---

## ジョブ設計

既存の jobs テーブル思想を継承する。

## 追加 type
- `discord_notify`
- `discord_summary`
- `discord_healthcheck`

## retry 方針
- 1回目失敗: 30秒後
- 2回目失敗: 5分後
- 3回目失敗: 30分後
- 4回失敗で停止し UI に表示

## retry 対象
- Discord 5xx
- ネットワーク失敗
- 一時的 rate limit

## retry しない
- 署名不正
- channel mismatch
- client not found
- validation error

---

## レート制御

- Discordの rate limit は**固定値を埋め込まない**
- RESTレスポンスヘッダーを見て待つ
- `429` は `retry_after` に従う
- channel 連投を避けるため、サマリは1メッセージに集約
- burst 通知が起きるときは jobs 側でキュー制御する

---

## セキュリティ実装チェックリスト

- [ ] Signature verify 前に payload を信用していない
- [ ] timestamp リプレイ対策を入れた
- [ ] service role key を client 側へ流していない
- [ ] interaction_id で idempotency を入れた
- [ ] delivery dedupe_key を入れた
- [ ] 接続チャンネル一致を必須にした
- [ ] 金額表示を禁止した
- [ ] クライアント自動作成を禁止した
- [ ] audit log に source=discord を入れた
- [ ] 失敗時に last_error を UI で見られる

---

## テスト仕様

## 単体テスト

### 署名検証
- 正常署名
- 不正署名
- 古い timestamp
- 空 body

### client 解決
- 完全一致
- 正規化一致
- 複数候補
- 0件

### `/add`
- due_editor_at 自動補完
- interaction_id 重複
- 日付不正
- unit_price 不正
- past due 許可

### `/info`
- 0件
- 1件
- 複数件
- LLM失敗フォールバック

### `/audit`
- limit 正規化
- 0件
- source=discord 優先

## 結合テスト

1. Discord install → callback → channel 保存
2. `/info` 実行 → 結果返却
3. `/add` 実行 → content insert → audit log 保存
4. `/audit` 実行 → 最新ログ返却
5. 外注未提出発生 → 通知送信
6. 同じ dedupe_key で再送されない
7. 状態変化で再送される
8. bot 権限剥奪 → health fail 表示

## E2Eテスト

### 正常系
- owner が接続
- 管理チャンネルで `/add`
- `/contents` に追加済み
- Link Button で対象画面へ飛ぶ
- `/audit` に追加操作が見える

### 異常系
- 他チャンネルで `/add`
- client 不一致
- 署名不正
- Discord送信429
- follow-up 失敗

---

## 実装順

## Phase 0
1. Discord App 作成
2. env 設定
3. migration 作成

## Phase 1
1. `/settings/integrations/discord`
2. install callback
3. interaction endpoint
4. signature verify
5. command router

## Phase 2
1. `/info`
2. `/add`
3. `/audit`
4. embed + link button

## Phase 3
1. 即時通知
2. 朝夕サマリ
3. health check
4. retry / error UI

## Phase 4
1. LLM要約改善
2. 検索改善
3. analytics 計測
4. global command 検討

---

## 計測

モニター検証で最低限見る数字:

- `/add` 実行回数
- `/add` 成功率
- `/add` 平均入力完了時間
- `/info` 実行回数
- `/info` から deep link クリック率
- 外注未提出通知の件数
- 納期遅れ通知の件数
- Discord導線経由の `/contents` 更新率

---

## Definition of Done

- [ ] Discord App を1 Org に接続できる
- [ ] 管理チャンネルを1つ設定できる
- [ ] `/info` がそのチャンネルで動く
- [ ] `/add` がそのチャンネルで動く
- [ ] `/audit` がそのチャンネルで動く
- [ ] 他チャンネルでは拒否する
- [ ] 金額を表示しない
- [ ] `/add` が interaction 再送で二重登録しない
- [ ] 通知が dedupe_key で重複しない
- [ ] 失敗ログが設定画面で見える
- [ ] 監査ログに source=discord が残る
- [ ] deep link で対象画面に飛べる

---

## 将来拡張

## Phase 2候補
- Discord account linking
- `/today`
- `/overdue`
- 参加申請通知
- 締め準備完了通知
- 複数チャンネル振り分け
- client 自動作成
- 自然文登録
- Link Button 以外のカスタムボタン
- member 向け read-only チャンネル
- Discordロール連携

---

## 実装しないほうがよいこと

- 公開チャンネルで `/add`
- anon key + RLS で Discord interaction を処理
- `/add` で client を勝手に新規作成
- LLMだけで `/info` を答える
- 通知の dedupe なし送信
- いきなり global command 前提
- 金額や支払い予定を Discord に出す
- ボタンで承認 / 請求実行などの破壊的操作を入れる

---

## 参考実装メモ

### `client_name` 正規化例
- trim
- 全角スペース → 半角
- `株式会社` の前後ゆれ吸収
- 大文字小文字正規化
- 連続空白圧縮

### `date` parse
- 許可形式は `YYYY-MM-DD` のみ
- 不正なら即エラー
- `2026/04/08` は不許可にしてよい
- 入力ゆれを受けたい場合は Phase 2

### LLM timeout
- 2.0 秒を超えたら要約なしの deterministic response に切り替える

### ephemeral
- `/info`, `/add`, `/audit` の返答は原則 ephemeral
- 通知とサマリは通常投稿

---

## 参考資料

### 内部資料
- `SNS_Ops_SaaS_Design_Spec_Complete_v2 (1).md`
- `PMF_and_Standardization_Strategy (1).md`
- `開発方法.txt`

### Discord公式
- OAuth2  
  https://docs.discord.com/developers/topics/oauth2
- Receiving and Responding  
  https://docs.discord.com/developers/interactions/receiving-and-responding
- Application Commands  
  https://docs.discord.com/developers/interactions/application-commands
- Components & Modals  
  https://docs.discord.com/developers/platform/components
- Permissions  
  https://docs.discord.com/developers/topics/permissions
- Rate Limits  
  https://docs.discord.com/developers/topics/rate-limits