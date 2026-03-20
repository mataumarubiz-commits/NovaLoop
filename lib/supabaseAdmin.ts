import { createClient } from "@supabase/supabase-js"

/**
 * Server only. Use SUPABASE_SERVICE_ROLE_KEY for RLS bypass (e.g. PDF generation).
 */
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !key) {
    throw new Error(
      "Supabase server settings are missing. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    )
  }

  return createClient(url, key)
}
