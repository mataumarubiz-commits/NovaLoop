import { createClient } from "@supabase/supabase-js"

/**
 * Server only. Use SUPABASE_SERVICE_ROLE_KEY for RLS bypass (e.g. PDF generation).
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("管理者向けの Supabase 設定が不足しています")
  return createClient(url, key)
}
