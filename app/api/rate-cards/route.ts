import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseNumber(value: unknown, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgPermission(req, "billing_access")
  if (!auth.ok) return auth.response

  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() ?? ""
  let query = auth.admin
    .from("rate_cards")
    .select(
      "id, org_id, project_id, client_id, item_type, unit_label, sales_unit_price, standard_cost, effective_from, effective_to, created_at, updated_at"
    )
    .eq("org_id", auth.orgId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: true })

  if (projectId) {
    query = query.eq("project_id", projectId)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rateCards: data ?? [] }, { status: 200 })
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgPermission(req, "billing_access")
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const itemType = typeof body.itemType === "string" ? body.itemType.trim() : ""
  if (!itemType) {
    return NextResponse.json({ ok: false, message: "itemType is required" }, { status: 400 })
  }

  const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom.trim() : ""
  if (!effectiveFrom) {
    return NextResponse.json({ ok: false, message: "effectiveFrom is required" }, { status: 400 })
  }

  const payload = {
    id: randomUUID(),
    org_id: auth.orgId,
    project_id: typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null,
    client_id: typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null,
    item_type: itemType,
    unit_label: typeof body.unitLabel === "string" && body.unitLabel.trim() ? body.unitLabel.trim() : "\u672C",
    sales_unit_price: parseNumber(body.salesUnitPrice, 0),
    standard_cost: parseNumber(body.standardCost, 0),
    effective_from: effectiveFrom,
    effective_to: typeof body.effectiveTo === "string" && body.effectiveTo.trim() ? body.effectiveTo.trim() : null,
  }

  const { data, error } = await auth.admin.from("rate_cards").insert(payload).select("*").maybeSingle()
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rateCard: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOrgPermission(req, "billing_access")
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) {
    return NextResponse.json({ ok: false, message: "id is required" }, { status: 400 })
  }

  const payload = {
    project_id: typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null,
    client_id: typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null,
    item_type: typeof body.itemType === "string" && body.itemType.trim() ? body.itemType.trim() : null,
    unit_label: typeof body.unitLabel === "string" && body.unitLabel.trim() ? body.unitLabel.trim() : null,
    sales_unit_price:
      typeof body.salesUnitPrice === "number" || typeof body.salesUnitPrice === "string"
        ? parseNumber(body.salesUnitPrice, 0)
        : null,
    standard_cost:
      typeof body.standardCost === "number" || typeof body.standardCost === "string"
        ? parseNumber(body.standardCost, 0)
        : null,
    effective_from: typeof body.effectiveFrom === "string" && body.effectiveFrom.trim() ? body.effectiveFrom.trim() : null,
    effective_to: typeof body.effectiveTo === "string" && body.effectiveTo.trim() ? body.effectiveTo.trim() : null,
  }

  const filteredPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null))
  const { data, error } = await auth.admin
    .from("rate_cards")
    .update(filteredPayload)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select("*")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rateCard: data }, { status: 200 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgPermission(req, "billing_access")
  if (!auth.ok) return auth.response

  const id = req.nextUrl.searchParams.get("id")?.trim() ?? ""
  if (!id) {
    return NextResponse.json({ ok: false, message: "id is required" }, { status: 400 })
  }

  const { error } = await auth.admin.from("rate_cards").delete().eq("id", id).eq("org_id", auth.orgId)
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
