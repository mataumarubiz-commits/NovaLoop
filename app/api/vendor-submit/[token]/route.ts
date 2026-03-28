import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  isLinkValid,
  validateSubmissionPayload,
  type VendorSubmissionPayload,
  type ContentCandidate,
  type SubmissionLinkPublicInfo,
} from "@/lib/vendorSubmission"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ token: string }> }

/**
 * GET /api/vendor-submit/[token]
 * 公開: トークンから提出フォーム情報を取得（ログイン不要）
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params
    if (!token || token.length < 32) {
      return NextResponse.json({ ok: false, error: "無効なリンクです" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()

    // Fetch link with vendor and org info
    const { data: link } = await admin
      .from("vendor_submission_links")
      .select("*")
      .eq("token", token)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ ok: false, error: "このリンクは無効です" }, { status: 404 })
    }

    if (!isLinkValid(link)) {
      return NextResponse.json(
        { ok: false, error: "このリンクは有効期限切れまたは無効化されています" },
        { status: 410 }
      )
    }

    // Fetch org name
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", link.org_id)
      .single()

    // Fetch vendor name
    const { data: vendor } = await admin
      .from("vendors")
      .select("name")
      .eq("id", link.vendor_id)
      .single()

    // Check existing submission
    const { data: existingSub } = await admin
      .from("vendor_invoices")
      .select("id, status, total, submitted_at, submitter_name")
      .eq("org_id", link.org_id)
      .eq("vendor_id", link.vendor_id)
      .eq("billing_month", link.target_month)
      .eq("submission_link_id", link.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const alreadySubmitted = !!existingSub && existingSub.status !== "rejected"

    // Fetch content candidates for this vendor + month
    let contentCandidates: ContentCandidate[] = []
    try {
      const { data: assignments } = await admin
        .from("content_vendor_assignments")
        .select("content_id, unit_price_override")
        .eq("org_id", link.org_id)
        .eq("vendor_id", link.vendor_id)

      if (assignments && assignments.length > 0) {
        const contentIds = assignments.map((a: { content_id: string }) => a.content_id)
        const priceMap = new Map(
          assignments.map((a: { content_id: string; unit_price_override: number | null }) => [
            a.content_id,
            a.unit_price_override,
          ])
        )

        const { data: contents } = await admin
          .from("contents")
          .select("id, project_name, title, unit_price, quantity, delivery_month")
          .eq("org_id", link.org_id)
          .in("id", contentIds)

        if (contents) {
          contentCandidates = contents
            .filter((c: { delivery_month?: string | null }) => {
              if (!c.delivery_month) return false
              return c.delivery_month.startsWith(link.target_month)
            })
            .map((c: { id: string; project_name: string | null; title: string | null; unit_price: number | null; quantity: number | null; delivery_month: string | null }) => {
              const price = priceMap.get(c.id) ?? c.unit_price ?? 0
              const qty = c.quantity ?? 1
              return {
                id: c.id,
                project_name: c.project_name,
                title: c.title,
                unit_price: price,
                quantity: qty,
                amount: price * qty,
                delivery_month: c.delivery_month,
              }
            })
        }
      }
    } catch {
      // Content candidates are optional, don't fail the request
    }

    const info: SubmissionLinkPublicInfo = {
      token: link.token,
      org_name: org?.name ?? "",
      vendor_name: vendor?.name ?? "",
      target_month: link.target_month,
      custom_message: link.custom_message,
      expires_at: link.expires_at,
      allow_resubmission: link.allow_resubmission,
      already_submitted: alreadySubmitted,
      existing_submission: existingSub
        ? {
            id: existingSub.id,
            status: existingSub.status,
            total: existingSub.total,
            submitted_at: existingSub.submitted_at,
            submitter_name: existingSub.submitter_name,
          }
        : null,
      content_candidates: contentCandidates,
    }

    return NextResponse.json({ ok: true, data: info })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/vendor-submit/[token]
 * 公開: 外注が請求を提出する（ログイン不要）
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params
    if (!token || token.length < 32) {
      return NextResponse.json({ ok: false, error: "無効なリンクです" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()

    // Fetch link
    const { data: link } = await admin
      .from("vendor_submission_links")
      .select("*")
      .eq("token", token)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ ok: false, error: "このリンクは無効です" }, { status: 404 })
    }

    if (!isLinkValid(link)) {
      return NextResponse.json(
        { ok: false, error: "このリンクは有効期限切れまたは無効化されています" },
        { status: 410 }
      )
    }

    // Check existing submission
    const { data: existingSub } = await admin
      .from("vendor_invoices")
      .select("id, status, submission_count")
      .eq("org_id", link.org_id)
      .eq("vendor_id", link.vendor_id)
      .eq("billing_month", link.target_month)
      .eq("submission_link_id", link.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingSub && existingSub.status !== "rejected" && !link.allow_resubmission) {
      return NextResponse.json(
        { ok: false, error: "すでに提出済みです。修正が必要な場合は担当者へご連絡ください。" },
        { status: 409 }
      )
    }

    // Parse and validate payload
    const body = await req.json().catch(() => ({})) as Partial<VendorSubmissionPayload>
    const validationError = validateSubmissionPayload(body)
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 })
    }

    const payload = body as VendorSubmissionPayload
    const now = new Date().toISOString()

    const bankJson = {
      bank_name: payload.bank_name.trim(),
      branch_name: payload.branch_name.trim(),
      account_type: payload.account_type,
      account_number: payload.account_number.trim(),
      account_holder: payload.account_holder.trim(),
    }

    const newCount = (existingSub?.submission_count ?? 0) + 1

    if (existingSub && (existingSub.status === "rejected" || link.allow_resubmission)) {
      // Update existing invoice (resubmission)
      const { error } = await admin
        .from("vendor_invoices")
        .update({
          status: "submitted",
          total: payload.amount,
          submitter_name: payload.submitter_name.trim(),
          submitter_email: payload.submitter_email.trim(),
          submitter_bank_json: bankJson,
          submitter_notes: payload.notes?.trim() || null,
          vendor_bank_snapshot: bankJson,
          submitted_at: now,
          resubmitted_at: now,
          submission_count: newCount,
          updated_at: now,
        })
        .eq("id", existingSub.id)

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }

      // Replace line items if provided
      if (payload.line_items && payload.line_items.length > 0) {
        await admin
          .from("vendor_invoice_lines")
          .delete()
          .eq("vendor_invoice_id", existingSub.id)

        const lines = payload.line_items.map((item, idx) => ({
          vendor_invoice_id: existingSub.id,
          content_id: item.content_id || null,
          description: item.description,
          qty: item.qty,
          unit_price: item.unit_price,
          amount: item.amount,
          source_type: item.content_id ? "content_auto" : "manual",
          sort_order: idx,
        }))

        await admin.from("vendor_invoice_lines").insert(lines)
      }

      return NextResponse.json({
        ok: true,
        invoiceId: existingSub.id,
        submittedAt: now,
        isResubmission: true,
      })
    }

    // Create new vendor_invoice
    const invoiceId = crypto.randomUUID()
    const { error: insertError } = await admin
      .from("vendor_invoices")
      .insert({
        id: invoiceId,
        org_id: link.org_id,
        vendor_id: link.vendor_id,
        billing_month: link.target_month,
        status: "submitted",
        total: payload.amount,
        submitter_name: payload.submitter_name.trim(),
        submitter_email: payload.submitter_email.trim(),
        submitter_bank_json: bankJson,
        submitter_notes: payload.notes?.trim() || null,
        vendor_bank_snapshot: bankJson,
        submitted_at: now,
        first_submitted_at: now,
        submission_count: 1,
        submission_link_id: link.id,
        item_count: payload.line_items?.length ?? 0,
      })

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
    }

    // Insert line items if provided
    if (payload.line_items && payload.line_items.length > 0) {
      const lines = payload.line_items.map((item, idx) => ({
        vendor_invoice_id: invoiceId,
        content_id: item.content_id || null,
        description: item.description,
        qty: item.qty,
        unit_price: item.unit_price,
        amount: item.amount,
        source_type: item.content_id ? "content_auto" : "manual",
        sort_order: idx,
      }))

      await admin.from("vendor_invoice_lines").insert(lines)
    }

    return NextResponse.json({
      ok: true,
      invoiceId,
      submittedAt: now,
      isResubmission: false,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
