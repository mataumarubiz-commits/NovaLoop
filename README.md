# NovaLoop Beta

Lycollection 向けモニターβです。

今回の目的は、既存の SNS 運用代行向け業務 OS を万能な業務管理ツールへ広げることではなく、複数商材の請求統合を PMF できる状態にすることです。

このブランチでは、既存の請求フローを壊さずに 1 回の月次請求で次の区分を同時に扱えるようにしています。

- 月額固定
- 本数従量
- 案件一式
- 追加オプション

## コアモデル

請求の元データは引き続き `contents` を使います。

- 1 行 = 1 請求可能な作業単位

例:

- `2026-03` の YouTube 運用
- Shorts 追加制作 12 本
- キャスティングのディレクション費 1 件
- インフルエンサー起用 2 名分
- LP 制作 1 件
- Live2D モデル制作 1 件

## この β で追加したもの

- `supabase/sql/057_work_items_beta.sql`
  - `contents` を請求作業ユニットとして拡張
  - `service_catalogs` を追加
  - `workflow_templates` を追加
- 複数商材対応の請求候補プレビュー / 一括ドラフト生成
- `invoice_lines.quantity` / `unit_price` / `amount` を前提にした明細生成
- Lycollection 向け demo seed API
- `/contents` の請求作業ユニット UI

## 5分デモ

1. 最新 SQL を反映します。最低でも `supabase/sql/057_work_items_beta.sql` を適用してください。
2. `npm run dev` で起動します。
3. `owner` か `executive_assistant` でログインします。
4. `/contents` を開きます。
5. `Lycollection デモを投入` を押します。
6. 対象月 `2026-03` の作業が 8 件表示されることを確認します。
7. `/contents` で次の絞り込みが使えることを確認します。
   - 取引先
   - 商材区分
   - 請求区分
   - 対象月
8. `/billing?month=2026-03` を開きます。
9. 月次請求を一括発行します。
10. クライアントごとに請求書ドラフトがまとまり、明細に `quantity` / `unit_price` / `amount` が反映されていることを確認します。
11. 各請求書で PDF が生成できることを確認します。

## デモ用サンプル 8 件

`2026-03` のデモ seed は次の 8 件です。

- A社: YouTube チャンネル運用
- A社: Shorts 追加制作 12 本
- B社: YouTube 通常動画編集 4 本
- B社: サムネイル制作 4 件
- C社: キャスティングディレクション費
- C社: インフルエンサー起用費 2 名分
- D社: LP 制作
- E社: Live2D モデル制作

## 検証

```bash
npm run typecheck
```

ローカル開発と本番ビルドは `npm run dev` / `npm run build` ともに webpack を明示利用します。Windows 環境での Turbopack 不安定化を避けるためです。

## 補足

- 請求対象月の基準は引き続き `delivery_month` です。
- `target_month` は UI / フィルタ互換のための見せ方で、請求の正本カラムではありません。
- 税区分は免税のままです。
- 請求書送付は PDF 生成までで、自動メール送信は行いません。
