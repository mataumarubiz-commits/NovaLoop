import { NextRequest, NextResponse } from "next/server"
import {
  DOCUMENT_PDF_FILTER_OPTIONS,
  DOCUMENT_SORT_OPTIONS,
  loadDocumentsArchive,
  parseDocumentsArchiveMonth,
  type DocumentPdfFilter,
  type DocumentSort,
} from "@/lib/documentsArchive"
import { requireAdminActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parsePdfFilter(value: string | null): DocumentPdfFilter {
  return DOCUMENT_PDF_FILTER_OPTIONS.includes(value as DocumentPdfFilter) ? (value as DocumentPdfFilter) : "all"
}

function parseSort(value: string | null): DocumentSort {
  return DOCUMENT_SORT_OPTIONS.includes(value as DocumentSort) ? (value as DocumentSort) : "newest"
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdminActor(req)
    const rawMonth = req.nextUrl.searchParams.get("month")
    const month = parseDocumentsArchiveMonth(rawMonth)
    if (rawMonth && !month) {
      return NextResponse.json({ ok: false, error: "month は YYYY-MM 形式で指定してください。" }, { status: 400 })
    }
    const status = req.nextUrl.searchParams.get("status")?.trim() || null
    const pdfFilter = parsePdfFilter(req.nextUrl.searchParams.get("pdf"))
    const query = req.nextUrl.searchParams.get("q")?.trim() || ""
    const sort = parseSort(req.nextUrl.searchParams.get("sort"))
    const monthLimit = Math.min(Math.max(parsePositiveInt(req.nextUrl.searchParams.get("monthLimit"), 6), 1), 12)
    const monthOffset = parsePositiveInt(req.nextUrl.searchParams.get("monthOffset"), 0)

    const archive = await loadDocumentsArchive({
      orgId: actor.orgId,
      month,
      status,
      pdfFilter,
      query,
      sort,
      monthLimit,
      monthOffset,
    })

    return NextResponse.json({
      ok: true,
      archive,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "請求書保管の取得に失敗しました。" },
      { status: 400 }
    )
  }
}
