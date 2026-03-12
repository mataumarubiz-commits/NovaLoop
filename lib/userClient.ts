import { createClient } from "@supabase/supabase-js"
import type { NextRequest, NextResponse } from "next/server"

export function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("Authorization")
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
}

export function createUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export type ApiAuthResult =
  | { supabase: ReturnType<typeof createUserClient>; userId: string }
  | { error: NextResponse }
