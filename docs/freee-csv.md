# freee 用 売上CSV

請求書一覧（/invoices）から「freee用 売上CSV」でダウンロードできるCSVの仕様です。  
MVP では client 単位の売上高（税抜）を出力。freee の厳密な取込フォーマットは後続で対応可能。

## 列定義（現行）

| 列名 | 説明 |
|------|------|
| クライアント名 | clients.name |
| 対象月 | invoice_month (YYYY-MM) |
| 売上高(税抜) | invoices.subtotal（税なし・免税） |
| 発行日 | issue_date (YYYY-MM-DD) |
| 支払期限 | due_date (YYYY-MM-DD) |

- エンコーディング: UTF-8（BOM 付き）
- 区切り: カンマ
- 文字列はダブルクォートで囲む

## 外注費CSV（/payouts から「freee用 外注費CSV」）

| 列名 | 説明 |
|------|------|
| 支払先名 | vendors.name |
| 対象月 | vendor_invoices.billing_month (YYYY-MM) |
| 支払予定日 | vendor_invoices.pay_date (YYYY-MM-DD) |
| 金額 | vendor_invoices.total |
| ステータス | draft/submitted/approved/paid の表示名 |

- エンコーディング: UTF-8（BOM 付き）
- 区切り: カンマ
- 税/源泉は MVP では扱わない

## 今後の拡張

- freee の「経費・売上取込」フォーマットに合わせた列名・日付形式の調整
- 税区分・勘定科目・源泉徴収などの列追加
