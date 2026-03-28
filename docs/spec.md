# SNS Ops SaaS Spec (MVP1)

## MVP1 Scope
- 制作シート（1行=1本）+ ホーム（KGI/KPI）
- 請求：ドラフト一括生成 → 発行（採番） → PDF生成 → Vault保存
- Vault：請求PDFの保管とDL（削除禁止）
- 外注請求/支払/全銀FB/freee同期はMVP2以降（今は作らない）

## Roles / Permissions
- roles: owner, executive_assistant, pm, director, worker
- 制作（contents）は社内メンバーが閲覧できる
- 請求（billing）とVaultは owner/executive_assistant のみ

## Contents (制作シート)
- 1行 = 1本（動画/投稿）
- 必須: client, project_name, title, due_client_at（先方提出日）, unit_price（単価）
- due_editor_at（編集者提出日）は due_client_at - 3日 を自動提案（編集可）
- thumbnail_done: checkbox（初期OFF→完成したらON）
- billable_flag: checkbox（没でも請求してOKなので、ここで制御）
- delivery_month: 請求対象月（YYYY-MM）。納品完了になると必須。

## Home (ホーム)
- 上にKGI（1行テキスト）
- KPI:
  - 今日の先方提出：総数 / 未完了数
  - 明日の先方提出：総数 / 未完了数
  - 外注未提出（編集者提出遅れ）：due_editor_at を過ぎて未完了の数
- 下に制作一覧（未完了、先方提出日昇順）
- バッジ:
  - 要注意：先方提出の1日前目標を過ぎて未完了
  - 納期遅れ：先方提出日を過ぎて未完了
  - サムネ未：thumbnail_done=OFF

## Billing (請求)
- 対象月 = delivery_month
- 条件：delivery_month=対象月 AND status=納品完了 AND billable_flag=true AND 未請求
- クライアントごとに請求書（draft）を生成し、明細はコンテンツ単位
- 税：免税（消費税なし）
- 支払期限：翌月末
- 送付：PDF生成して保管（送付は人間）
- 宛名：法人=御中、個人=様
- 請求名（invoice_title）は編集可能
- 採番：INV-YYYY-0000001 形式（通し）

## Vault (保管庫)
- PDFをStorageへ保存し、Vaultに索引として登録
- 月で絞れる（今月デフォ）
- DLできる
- UIから削除はしない