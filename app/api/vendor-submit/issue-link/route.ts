import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { generateSubmissionToken, isValidMonth } from "@/lib/vendorSubmission"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/vendor-submit/issue-link
 * 社内管理者がvendor向け請求提出URLを発行する
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const vendorId = typeof body?.vendorId === "string" ? body.vendorId.trim() : null
    const targetMonth = typeof body?.targetMonth === "string" ? body.targetMonth.trim() : null
    const expiresAt = typeof body?.expiresAt === "string" ? body.expiresAt.trim() : null
    const allowResubmission = body?.allowResubmission === true
    const customMessage = typeof body?.customMessage === "string" ? body.customMessage.trim() || null : null

    if (!orgId || !vendorId || !targetMonth) {
      return NextResponse.json(
        { ok: false, error: "orgId, vendorId, targetMonth は必須です" },
        { status: 400 }
      )
    }

    if (!isValidMonth(targetMonth)) {
      return NextResponse.json(
        { ok: false, error: "targetMonth は YYYY-MM 形式で入力してください" },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    // Verify vendor exists
    const { data: vendor } = await admin
      .from("vendors")
      .select("id, name")
      .eq("id", vendorId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!vendor) {
      return NextResponse.json({ ok: false, error: "外注先が見つかりません" }, { status: 404 })
    }

    // Check for existing active link for same vendor + month
    const { data: existingLink } = await admin
      .from("vendor_submission_links")
      .select("id, token")
      .eq("org_id", orgId)
      .eq("vendor_id", vendorId)
      .eq("target_month", targetMonth)
      .eq("is_active", true)
      .maybeSingle()

    if (existingLink) {
      // Return existing link instead of creating duplicate
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
      return NextResponse.json({
        ok: true,
        link: existingLink,
        url: `${baseUrl}/vendor-submit/${existingLink.token}`,
        isExisting: true,
      })
    }

    const token = generateSubmissionToken()

    const { data: link, error } = await admin
      .from("vendor_submission_links")
      .insert({
        org_id: orgId,
        vendor_id: vendorId,
        token,
        target_month: targetMonth,
        expires_at: expiresAt || null,
        is_active: true,
        allow_resubmission: allowResubmission,
        custom_message: customMessage,
        created_by: userId,
      })
      .select("id, token, target_month, expires_at, allow_resubmission, created_at")
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    return NextResponse.json({
      ok: true,
      link,
      url: `${baseUrl}/vendor-submit/${token}`,
      isExisting: false,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
