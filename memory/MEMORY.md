# Project Memory: SNS Ops SaaS (NovaLoop)

## Project Overview
- SNS運用代行向け業務OS (Next.js + Supabase)
- 月300件請求 / 月250件外注支払い
- UI: 白×薄紫 / 黒×濃紫 (CSS変数 --bg-grad, --surface 等)
- 税: 免税 (消費税なし)

## Key Files
- `docs/spec.md` — 仕様書 (文字化けあり、主要ルールのみ残存)
- `docs/decision-log.md` — 決定ログ D001〜D071
- `docs/TODO.md` — NOW/NEXT/LATER/DONE で整理済み
- `AGENTS.md` — 開発ルール

## Tech Stack
- Next.js App Router (TypeScript)
- Supabase (Auth + DB + Storage)
- TipTap (Pages エディタ)
- puppeteer-core + @sparticuz/chromium (PDF生成)
- OpenAI API (AI Palette)

## Roles & Permissions
- owner / executive_assistant: 全機能
- pm / director / worker / member: contents閲覧・編集のみ
- billing/invoices/vendors/payouts/export/import: owner/assistant のみ
- RLS再帰回避: SECURITY DEFINER関数 is_org_member / user_role_in_org を使用

## DB Key Tables
- organizations, app_users (membership), user_profiles (active_org_id)
- clients, contents (1行=1コンテンツ)
- invoices, invoice_lines
- vendors, vendor_invoices, vendor_invoice_lines, content_vendor_assignments, payouts
- pages, page_comments, page_revisions, audit_logs
- content_templates, org_roles, org_invites, join_requests, notifications
- export_jobs, import_jobs, import_mappings, ai_logs

## SQL migrations
- 001〜039: supabase/sql/*.sql (idempotentが基本)
- 最新: 039_page_comments_selection_range.sql

## Key Hooks / Lib
- `hooks/useAuthOrg.ts` — auth+org+role統合フック
- `lib/apiAuth.ts` — API側Bearer認証
- `lib/auditLog.ts` — 監査ログ書き込み

## Current State (2026-03-08)
- 全機能のコードは実装済み (D001〜D120)
- NOWタスク: D059/D061〜D070 が「動作確認」待ち
- 最優先エピック D071: /settings/health に T9(page-assets verify) / T10(invoice PDF verify) を追加 → 完了

## Key Decisions
- payoutsテーブル(033): Import専用、/payoutsページはvendor_invoicesを参照する設計
- invoice PDF: 手動アップロード廃止、サーバーサイドpuppeteerで自動生成
- app_users RLS再帰: SECURITY DEFINER関数で回避
- Export: private bucket "exports"、path=org/{org_id}/exports/{job_id}.json
