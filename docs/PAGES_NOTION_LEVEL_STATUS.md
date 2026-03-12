# Pages Notion代替レベル 実装状況

親仕様: SNS_Ops_SaaS_Design_Spec_Complete_v2.md 準拠。  
D115・D116・D117 で「Notion代替にかなり近いレベル」まで実装済みです。

---

## 1. 変更ファイル一覧（既存実装）

| 種別 | パス |
|------|------|
| DB | `supabase/sql/036_audit_logs.sql` |
| DB | `supabase/sql/037_page_comments.sql` |
| DB | `supabase/sql/038_page_revisions.sql` |
| DB | `supabase/sql/039_page_comments_selection_range.sql` |
| API | `app/api/pages/create/route.ts` |
| API | `app/api/pages/[id]/route.ts` (PATCH) |
| API | `app/api/pages/[id]/duplicate/route.ts` |
| API | `app/api/pages/[id]/archive/route.ts` |
| API | `app/api/pages/[id]/unarchive/route.ts` |
| API | `app/api/pages/[id]/comments/route.ts` (GET/POST) |
| API | `app/api/pages/[id]/comments/[commentId]/route.ts` (DELETE) |
| API | `app/api/pages/[id]/revisions/route.ts` (GET) |
| API | `app/api/pages/[id]/restore/route.ts` (POST) |
| Lib | `lib/auditLog.ts` |
| Lib | `lib/pageTemplates.ts`（6テンプレ） |
| Lib | `lib/embedExtension.ts` |
| Lib | `lib/slug.ts` |
| UI | `app/pages/page.tsx`（一覧・ソート・アーカイブ復元） |
| UI | `app/pages/[id]/page.tsx`（編集・コメント/履歴パネル・復元・URLコピー・埋め込み・チェックリスト・見出しリンク） |
| UI | `components/Sidebar.tsx`（Pages 展開・新規ページ・テンプレモーダル） |
| UI | `components/AIPalette.tsx`（手順化モード） |
| Docs | `docs/decision-log.md`（D115, D116, D117） |
| Docs | `docs/TODO.md`（DONE に記載済み） |

---

## 2. 追加済み SQL 一覧

| ファイル | 内容 |
|----------|------|
| `036_audit_logs.sql` | audit_logs テーブル（action, resource_type, resource_id, meta）。RLS: org メンバー SELECT、挿入は API 経由想定。 |
| `037_page_comments.sql` | page_comments（id, org_id, page_id, user_id, body, created_at, deleted_at）。RLS: org メンバー SELECT/INSERT、本人または owner/executive_assistant で UPDATE（soft delete）。 |
| `038_page_revisions.sql` | page_revisions（id, org_id, page_id, title, body_json, updated_by_user_id, created_at）。RLS: org メンバー SELECT、挿入は API 経由。 |
| `039_page_comments_selection_range.sql` | page_comments に selection_range (jsonb) 追加。選択範囲コメント拡張用。 |
| `035_pages_slug_archived_at.sql` | pages に slug, archived_at 追加（既存）。 |

---

## 3. 今回追加した Notion 代替レベルの機能一覧（既に実装済み）

| # | 要件 | 対応内容 |
|---|------|----------|
| 1 | コメント | ページ単位コメント。一覧表示・追加・削除（本人または owner/executive_assistant）。作成者・作成日時表示。選択範囲コメント用に selection_range 対応。 |
| 2 | 更新履歴 | 保存時に全文スナップショットを page_revisions に保存。直近50件取得。誰がいつ更新したか表示。 |
| 3 | 復元 | 履歴一覧から「この版に戻す」。確認モーダル必須。member は復元不可。復元操作を audit に記録。 |
| 4 | テンプレ | 業務マニュアル・クライアント運用・請求手順・外注支払い・議事録・チェックリストの6種。サイドバー/一覧でテンプレ選択。既存ページは複製で流用。 |
| 5 | 埋め込み | YouTube / Loom / Google Drive・Docs をホワイトリストで iframe 表示。URL のみ段落はカード表示。埋め込みモーダルで URL 挿入。 |
| 6 | 共有性 | 「URLをコピー」ボタン。タイトル・slug 表示。閲覧専用でも崩れない。ページ・見出しへリンク挿入（#slug）。 |
| 7 | 履歴/コメント UI | 右パネルで「コメント」「更新履歴」タブ切替。モバイルでも同一パネル。 |
| 8 | 一覧運用 | 並び順（ドラッグ）/ 最近更新した順 / タイトル順。サイドバーでページ検索。アーカイブ済み表示・復元（管理者のみ）。 |
| 9 | ページ内チェックリスト | TipTap TaskList + TaskItem。ツールバー「チェックリスト」で挿入。保存・リロードで維持。 |
| 10 | AI 接続準備 | 選択範囲取得・BubbleMenu/ツールバー「AI」「AIで手順化」。decision-log に AI 接続ポイント明記済み。 |
| 11 | 監査ログ | page.create / page.update / page.duplicate / page.archive / page.restore / page.comment.create / page.comment.delete / page.revision.restore を audit_logs に記録。 |
| 12 | 権限 | member 閲覧のみ。owner / executive_assistant が編集・コメント・履歴復元可。コメント削除は本人または owner/executive_assistant。サーバ側で role チェック済み。 |

---

## 4. まだ足りない部分（任意・将来）→ D119 で対応済み

- **選択範囲コメントのハイライト表示**: 対応済み。CommentHighlightExtension でコメントクリック時に該当範囲をエディタ内でハイライト（.pages-comment-highlight）。
- **埋め込み iframe の追加ドメイン**: 対応済み。Figma / Miro / Vimeo / CodePen をホワイトリストに追加し embed URL 変換を実装。
- **差分表示**: 対応済み。更新履歴の「差分」ボタンで選択版と現在版のプレーンテキストを diff 表示（緑＝追加・赤＝削除）。
- **Notion風ブロックアンカー**: 対応済み。.ProseMirror > * に block-0, block-1… を付与。「ブロックリンクをコピー」で URL#block-N をコピー。URL に #block-N 付きで開くと該当ブロックへスクロール。

---

## 5. ローカル確認手順

1. **マイグレーション**  
   `supabase/sql/` の 035〜039 を Supabase に適用（未適用の場合）。

2. **コメント**  
   - 任意のページを開く → 右「コメント・履歴」→ コメントタブで「コメントを追加…」から投稿。  
   - 一覧に作成者・日時表示。本人または管理者で「削除」可能。

3. **更新履歴・復元**  
   - 同じく右パネル「更新履歴」タブで直近の履歴を表示。  
   - owner/executive_assistant で「この版に戻す」→ 確認モーダル → 復元。

4. **テンプレ**  
   - サイドバーで「＋ 新規ページ」または Pages 展開中の「新規ページを追加」→ テンプレ選択（空白・業務マニュアル・議事録・チェックリスト等）。  
   - /pages 一覧で 0 件時はテンプレから作成ボタンで作成可能。

5. **埋め込み**  
   - ページ編集でツールバー「埋め込み」→ YouTube 等の URL を入力して挿入。ホワイトリスト外はリンク表示。

6. **共有**  
   - 編集画面メタ付近の「URLをコピー」でページ URL をコピー。slug はメタに表示。

7. **チェックリスト**  
   - ツールバー「チェックリスト」でタスクリスト挿入。チェック状態は保存・リロードで維持。

8. **一覧**  
   - /pages で並び替え（並び順 / 最近更新した順 / タイトル順）。「アーカイブ済みを表示」で復元（管理者のみ）。

9. **権限**  
   - member でログインすると編集・復元・コメント削除（他人分）は不可。owner/executive_assistant で同操作が可能なことを確認。

10. **監査**  
    - `audit_logs` テーブルで page.create / page.update / page.comment.create 等が記録されていることを DB 上で確認。

---

**結論**: ご依頼の「Notion代替にかなり近いレベル」の追加・補完は、既に D115〜D117 で実装済みです。新たなコード変更は行わず、上記の通り受け入れ条件は満たされています。
