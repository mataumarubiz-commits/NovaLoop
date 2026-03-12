# TODO

## NOW
- Epic-12: Bill Change に負ける可能性がある点の完全解消（進行中）
  - Invoices: 一括選択、一括発行 / Draft戻し / 無効化、一括PDF ZIP、一括送付準備を追加
  - Invoices: ゲスト宛先の会社名対応と「複製して新規」中心の再利用導線を整備
  - Payouts: 銀行CSV設定、プレビュー、出力履歴、文字コード注意、CSV出力導線を追加
  - Payouts: 既存の外注請求一括承認 / 差し戻し / 支払済み導線を運用品質へ整理
  - Reminder: 請求依頼 / 外注請求依頼の期限接近・超過リマインドログと通知を追加
  - Settings: Workspace に銀行CSV設定、Members に会計運用向けロール説明を追加
  - Docs: Bill Change 比較で見つかった弱点、一括操作方針、CSV方針、リマインド方針を decision-log へ追記
  - Reminders: `/api/invoice-requests/reminders` に cron 向け自動実行入口を追加し、Payouts 画面表示時の副作用実行を撤去
  - Reminders: cron 実行時は `INVOICE_REMINDER_CRON_SECRET` で org 指定実行できるようにし、管理者ログイン依存を除去
- Epic-1: Notifications center + /home KPI + 遅延検知の実運用化（進行中）
  - `/api/notifications/digest` を通知センター標準typeへ更新（membership/contents/billing/payouts）
  - 通知一覧を再構成（未読/既読切替、個別既読、一括既読、優先度順、経過時間、実務導線）
  - Home / Sidebar(Menu) を共通優先度ルールへ統一し、未読表示を新typeへ整合
  - 通知取得・既読処理を `/api/notifications/list|mark-read|mark-all-read` 経由に統一（orgガード）
  - 既存通知typeの整合migration追加（`042_notifications_type_alignment.sql`）
- Epic-7: Menu / Home / Pages の運用最適化（進行中）
  - Sidebar: 通知導線の上部固定、Pages 行操作（複製/アーカイブ）、+CTA を3アクション化
  - Sidebar: 通知センターに未読バッジを表示
  - Sidebar: 下段レイアウトを Pages / CTA / Settings に固定
  - Sidebar: ログアウト導線を下段で視認しやすいセカンダリCTAに再調整
  - Sidebar: 未読通知ドロップダウンから直接「対応する」導線を追加
  - Home: KPI 7種 + 行動導線 + 通知サマリ + 締め状況を司令塔として統合
  - Home: owner / executive_assistant / member(閲覧主体) で優先アクション導線を最適化
  - Home: クライアント別の危険案件（納期遅れ/外注遅延）を上位表示して即対応導線を追加
  - Home: 優先度付き「今すぐ動くタスク」を追加し、危険案件を件数ベースで即遷移可能に整理
  - Home: 通知サマリに危険度ラベル/経過時間を追加し、締め状況に進捗バーを追加
  - Pages詳細: 文字化け文言を解消し、コメント/履歴/目次/ツールバー文言を運用品質へ統一
  - Pages詳細: タイトル文脈に応じた実務CTA（請求/支払い/運用）を自動切替し、関連ページリンクを常設
  - Pages詳細: コメント/履歴パネルに検索を追加し、長文運用時の探索性を改善
  - Pages詳細: 関連ページをキーワード近傍優先で表示し、ナレッジ間導線を強化
  - Sidebar: 未読通知を重要度順（deadline/vendor_delay/payout）で表示し、導線優先度を固定
  - Sidebar: 未読通知の先頭を最優先表示し、Pages件数表示とNEW CTA補助文で地図性を強化
  - Help Center: `/help` を追加（左カテゴリナビ / 検索 / おすすめ読み順 / カテゴリ別カード / モバイル折りたたみ）
  - Help Center: `/help/[slug]` プレースホルダ記事ルートを追加（将来DB化前提の href/slug 構造）
  - Help Center: 一覧/詳細のUIと文言を再整理し、実運用で読める品質まで引き上げる
  - 安定化: `app/contents` の文字化け由来の構文崩れを修正し lint エラーを解消
  - 安定化: `app/invoices/[id]` を安全な詳細表示実装へ再構成し、請求詳細の閲覧/PDF導線/権限制御を維持
  - Contents連携: `/contents?newClient=1` でクライアント作成フォームを即時オープン

## NEXT
- Epic-4: Vendors / Payouts 完成（250件/月を安全運用）
- Billing / Vendors に請求依頼一覧の専用UIを追加し、通常請求依頼の運用画面を完成させる

## LATER
- Epic-2: /contents テンプレ一括運用の高度化
- Epic-6: AI導入準備（運用ログ・権限・安全策を先に固める）
- freee 同期の本格運用

## DONE
- Epic-3: Billing / Invoices 月次ワンボタン請求
  - Billing に月次請求プレビュー、クライアント絞り込み、重複時の扱い選択を追加
  - `delivery_month + billable_flag + invoice_id is null` を基準にクライアント別集計を実装
  - 同月既存請求書の検知、通常生成時スキップ、追加請求としての別作成を実装
  - 一括生成 / クライアント単位生成 / 生成ログ保存を実装
  - 生成後の PDF 自動作成、Invoices 一覧反映、月次ZIP出力を実装
  - Invoices 詳細に元コンテンツ追跡導線を追加
  - Billing / 月次請求API / 請求書ZIP の文言を日本語で再整備し、月末運用画面として読解性を改善
- Epic-8: Bill Change差分の機能補完
  - Workspace設定に自社情報（法人/個人事業主、請求者情報、固定メモ）を追加
  - 複数口座管理（一覧、追加、既定口座、委託者コード）を追加
  - Invoicesに手動請求書作成、ゲスト宛先、税/源泉/口座反映、コピー新規を追加
  - Billingに請求依頼 / 一括送信カードを追加し、既存導線内で統合
  - Vendors/Payoutsに振込先情報、一括ステータス変更、一括PDF ZIP出力、支払CSV出力を追加
  - Profileにメールアドレス/パスワード更新を追加
  - Workspace設定に紹介コード発行/一覧を追加
- Epic-12: Bill Change運用不足の追補
  - `/billing` を月次請求 + 請求依頼台帳の統合画面として再整理
  - 請求依頼に期限表示、手動リマインド記録、履歴表示、請求書化導線を追加
  - `/invoices/new?requestId=...` で請求依頼からの下書き作成を追加
  - `invoice-requests` API を期限 / リマインド情報付きで再整理
  - `Vendors / Vendor detail / Notifications / Invite` の文字化け画面を UTF-8 正常化し、既存 API 導線を維持したまま運用品質へ修正
- Epic-13: 外部チャットAIと横断 read-only オペレーター基盤
  - `053_external_ai_channels.sql` で `external_channel_links` / `ai_channel_settings` / `ai_chat_audit_logs` を追加
  - `lib/ai/*` に権限付き internal tool layer / identity link / gateway / audit を追加
  - `/api/ai/external/chat` `/discord/interactions` `/line/webhook` `/link/*` を追加
  - `/settings/ai-channels` で Discord / LINE の連携状態、連携コード発行、組織設定を追加
  - Discord / LINE はともに read-only で、linked user 未連携時は業務データを返さない
  - first-wave の質問カテゴリとして 全体状況 / 案件 / 請求 / 外注請求 / 支払い / 通知 / Pagesマニュアル を明示対応
  - Discord は要約 + `Nova loopを開く / 詳細を見る / 再読み込み`、LINE は短文 + 追質問候補を返す
  - 連携未完了 / 連携完了 / 通常回答 / データなし / 権限不足 / 一時エラー の文言を Discord / LINE / Settings で固定
  - Discord の button interaction を再問い合わせに接続し、`再読み込み / 承認待ちだけ / 差し戻しだけ / 遅延案件 / 未提出外注` を実行可能にした
  - `/settings/ai-channels` と AI copy 定義を UTF-8 で正常化し、運用時に読める文言へ修正
  - `/api/ai/external/chat` の未連携 / 一時エラー文言を固定 copy に統一
  - `/settings/ai-channels` を UTF-8 正常化し、連携状態 / コード発行 / 組織設定を実運用品質へ再整理
- Settings運用品質の最終正常化
  - `/settings` と `SettingsClient` の文言を UTF-8 正常化し、外部チャットAI / 通知 / アカウント導線を読みやすく整理
- Settings導線整理と文字化け除去
  - `/settings/workspace` の保存認証経路を統一
  - `/settings/org` を案内画面に整理して Workspace 設定へ集約
  - `/settings/profile` と `/payouts` の文言を運用品質へ修正
  - `/invoices` `/vendors` `/help` `/settings/workspace` `/settings/sql-assistant` `/components/Sidebar` の文言を日本語で再整備
  - `/settings/import` `/settings/e2e` `/onboarding` の文言を日本語で再整備
  - `docs/decision-log.md` を UTF-8 に正常化し、追記可能な状態へ修復
  - service-role 依存 API の失敗時応答を改善し、設定不足時のメッセージを整理
- /contents の1行運用と主要編集フロー
- Billing / Invoices MVP（発行・PDF保管の基礎）
- Vendors / Payouts MVP
- Epic-5: Health / E2E / audit 強化（回帰検知を標準化）
  - `/settings/health` を管理者向け診断画面として再構成
  - `/settings/e2e` を本番前確認のチェックリストとして再構成
  - `/settings/assets` `/settings/audit` を追加
  - export / import / payout / invoice PDF / membership / role 更新の監査ログを補強
  - `045_health_e2e_audit_finish.sql` で vendor invoice rejected と audit trigger を追加
- Pages Notion代替レベルの基盤
- Export / Import / Assets / E2E の基礎導入
- /home KPI 実データ化（today/tomorrow/client遅延/editor遅延）
- /notifications active org フィルタ + 通知種別表示

- 既存 sweep で見つかった /api/imports/apply の構文破損と /settings/members の直更新経路を修正

- /help 一覧と詳細の文字化け・Server Component 500 を修正し、ヘルプ導線を再安定化

- /help のおすすめ記事セクションを UTF-8 正常化し、表示対象を上位 3 件に統一

- [x] D187 おすすめ記事カードの余白と文字サイズを専用スタイルに調整

- [x] D188 ヘルプ上部の要約カードを撤去し案内文をおすすめ記事とはじめにへ再配置

- Epic-9: 外注セルフ請求確認フローの完成
  -  46_vendor_self_invoice_flow.sql で vendor profile / bank account / snapshot 列 / vendor RLS を追加
  - /vendor を初回登録 + 月次確認承認 + PDF 即時DL の画面へ再構成
  - content_vendor_assignments + contents から月次請求を自動組み立てし、差し戻し理由付き再提出を追加
  - 会社側の外注請求詳細に承認 / 差し戻し導線とスナップショット表示を追加

- [x] D190 外注セルフ請求の通知連携と会社側入口を補完
- [x] D192 外注ホーム導線を `ホーム / プロフィール / 口座 / 今月確認 / 履歴` の5画面に固定
- [x] D193 外注導線を `/vendor/invoices/current` 基準に再編し、ホーム状態カードを6パターン化
- [x] D194 会社側の外注請求導線を `Vendors 一覧 -> Vendor 詳細 -> 承認 / 差し戻し / payout` に整理
- [x] D195 月末の外注請求土台を `対象月指定 -> vendorごとにdraft自動組み立て -> 請求依頼送信` に固定
- [x] D196 差し戻し時の外注請求を `同一請求IDの修正再提出` フローに固定
- [x] D197 外注請求のPDFを submitted 時点で固定し、提出直後 / 今月請求 / 履歴詳細の3導線で再ダウンロード可能に統一
- [x] D198 外注セルフ請求フローの会社側 / 外注側導線と通知文言を UTF-8 正常化し、`/vendor` と `Vendors` を運用画面として読み切れる状態に再整理

- Epic-10: 使い方ページ / ヘルプセンター / 社内マニュアル運用の完成
  - lib/helpCenter.ts を導入・運用・請求・外注・AI・トラブルシュートの構成で再定義
  - /help と /help/[slug] を白薄紫トーンで再整理し、検索 / おすすめ / カテゴリ導線を強化
  - lib/pageTemplates.ts を業務手順書 / 運用ルール / 請求手順 / 外注支払い手順中心のテンプレへ再整理
  - /pages にマニュアルテンプレの常設導線と使い方リンクを追加
  - Home / Settings からヘルプへ自然に飛べる導線を追加

- Epic-11: 導入定着パックの完成
  - `051_adoption_pack.sql` で `analytics_events` / `onboarding_progress` / `feedback_submissions` を追加
  - `/api/onboarding/progress` で既存データから導入進捗を算出し、Home のチェックリストに反映
  - `/api/analytics/track` と `lib/analytics.ts` で軽量イベント計測を追加
  - `/api/settings/dashboard` と `/settings/dashboard` で最小の運用ダッシュボードを追加
  - Home に初回オンボーディングチェックリストとフィードバック導線を追加
  - `/help` を使い方ページとして再利用し、記事閲覧数をトラッキング
  - `GuideEmptyState` を追加し、Contents / Notifications など主要画面の空状態を導線付きに整理
  - Pages / Contents / Home から改善要望を送れる導線を追加

- ヘルプ / Pages / Contents の運用品質仕上げ
  - /help と /help/[slug] を UTF-8 正常化し、検索・おすすめ・カテゴリ・関連導線を運用品質へ修正
  - Contents 一覧の未接続だった 詳細 ボタンをモーダル化し、案件状況と次アクションを確認できるようにした

- 外注ポータルの実運用品質仕上げ
  - components/vendor/VendorPortalClient.tsx を UTF-8 正常化し、ホーム / プロフィール / 口座情報 / 今月の請求 / 履歴 / 詳細 を読みやすい日本語に整理
  - 差し戻し理由、PDF再ダウンロード、再提出導線、今月の請求明細をそのまま運用で使える形に再配置
