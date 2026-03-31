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
  const auth = await requireOrgPermission(req, "contents_write")
  if (!auth.ok) return auth.response

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim() ?? ""
  let query = auth.admin
    .from("content_templates")
    .select(
      "id, client_id, name, default_title, default_project_name, default_unit_price, default_billable_flag, default_status, default_due_offset_days, sort_order, created_at"
    )
    .eq("org_id", auth.orgId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (clientId) {
    query = query.eq("client_id", clientId)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, templates: data ?? [] }, { status: 200 })
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgPermission(req, "contents_write")
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) {
    return NextResponse.json({ ok: false, message: "name is required" }, { status: 400 })
  }

  const payload = {
    id: randomUUID(),
    org_id: auth.orgId,
    client_id: typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null,
    name,
    default_title: typeof body.defaultTitle === "string" && body.defaultTitle.trim() ? body.defaultTitle.trim() : null,
    default_project_name:
      typeof body.defaultProjectName === "string" && body.defaultProjectName.trim() ? body.defaultProjectName.trim() : null,
    default_unit_price: parseNumber(body.defaultUnitPrice, 0),
    default_billable_flag: body.defaultBillableFlag !== false,
    default_status: typeof body.defaultStatus === "string" && body.defaultStatus.trim() ? body.defaultStatus.trim() : "billable",
    default_due_offset_days: parseNumber(body.defaultDueOffsetDays, 0),
    sort_order: parseNumber(body.sortOrder, Date.now()),
  }

  const { data, error } = await auth.admin.from("content_templates").insert(payload).select("*").maybeSingle()
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, template: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOrgPermission(req, "contents_write")
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) {
    return NextResponse.json({ ok: false, message: "id is required" }, { status: 400 })
  }

  const payload = {
    client_id: typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null,
    name: typeof body.name === "string" ? body.name.trim() : null,
    default_title: typeof body.defaultTitle === "string" && body.defaultTitle.trim() ? body.defaultTitle.trim() : null,
    default_project_name:
      typeof body.defaultProjectName === "string" && body.defaultProjectName.trim() ? body.defaultProjectName.trim() : null,
    default_unit_price: typeof body.defaultUnitPrice === "number" || typeof body.defaultUnitPrice === "string" ? parseNumber(body.defaultUnitPrice, 0) : null,
    default_billable_flag: typeof body.defaultBillableFlag === "boolean" ? body.defaultBillableFlag : null,
    default_status: typeof body.defaultStatus === "string" && body.defaultStatus.trim() ? body.defaultStatus.trim() : null,
    default_due_offset_days:
      typeof body.defaultDueOffsetDays === "number" || typeof body.defaultDueOffsetDays === "string"
        ? parseNumber(body.defaultDueOffsetDays, 0)
        : null,
    sort_order: typeof body.sortOrder === "number" || typeof body.sortOrder === "string" ? parseNumber(body.sortOrder, 0) : null,
  }

  const filteredPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null))
  const { data, error } = await auth.admin
    .from("content_templates")
    .update(filteredPayload)
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .select("*")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, template: data }, { status: 200 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgPermission(req, "contents_write")
  if (!auth.ok) return auth.response

  const id = req.nextUrl.searchParams.get("id")?.trim() ?? ""
  if (!id) {
    return NextResponse.json({ ok: false, message: "id is required" }, { status: 400 })
  }

  const { error } = await auth.admin.from("content_templates").delete().eq("id", id).eq("org_id", auth.orgId)
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
