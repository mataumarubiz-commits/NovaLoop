/**
 * GET /api/receipts/:id  - 領収書詳細取得
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminAuth } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { orgId } = auth

  const { id: receiptId } = await params
  if (!receiptId) {
    return NextResponse.json({ error: "Receipt ID required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()

  const { data: receipt, error } = await admin
    .from("receipts")
    .select(
      "*, receipt_lines(id, description, quantity, unit_price, amount, tax_rate, sort_order)"
    )
    .eq("id", receiptId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (error || !receipt) {
    return NextResponse.json(
      { error: "領収書が見つからないか、アクセス権がありません" },
      { status: 404 }
    )
  }

  return NextResponse.json({ receipt })
}
