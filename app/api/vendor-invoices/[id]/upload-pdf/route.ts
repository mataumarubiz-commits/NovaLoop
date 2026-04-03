import { NextRequest, NextResponse } from "next/server"
import { saveVendorInvoicePdf } from "@/lib/vendorInvoicePdfStorage"
import { requireAdminActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function readPdfFile(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) throw new Error("PDF ファイルを選択してください。")
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("PDF ファイルのみ添付できます。")
  return file
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req)
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, error: "ID が必要です。" }, { status: 400 })

    const file = await readPdfFile(req)
    const result = await saveVendorInvoicePdf({
      orgId: actor.orgId,
      invoiceId: id,
      actorUserId: actor.userId,
      fileName: file.name,
      fileBytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      mode: "upload",
    })

    return NextResponse.json({
      ok: true,
      pdf_path: result.pdfPath,
      signed_url: result.signedUrl,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PDF 添付に失敗しました。" },
      { status: 400 }
    )
  }
}

