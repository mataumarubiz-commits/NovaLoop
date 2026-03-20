import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getAiActorFromRequest } from "@/lib/aiAuth"
import type { AiMode, AiSource } from "@/lib/aiClientEvents"
import { buildSystemPrompt, isAdminOnlyMode, kindForMode, trimForLog } from "@/lib/ai/internalText"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RequestBody = {
  mode?: AiMode
  instruction?: string
  text?: string
  context?: string
  source?: AiSource
  applyTarget?: string
  meta?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const mode = (body.mode ?? "summarize") as AiMode
  const instruction = body.instruction ?? ""
  const text = body.text ?? ""
  const context = body.context ?? ""
  const source = body.source ?? (mode === "sql_draft" ? "sql" : "other")
  const applyTarget = typeof body.applyTarget === "string" ? body.applyTarget.trim() || null : null
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {}

  if (!text.trim() && !context.trim()) {
    return NextResponse.json({ error: "text or context is required" }, { status: 400 })
  }

  const actor = await getAiActorFromRequest(req)
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (actor.role === "member" && isAdminOnlyMode(mode)) {
    return NextResponse.json({ error: "この AI 機能は owner / executive_assistant のみ利用できます。" }, { status: 403 })
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest"
  const client = new OpenAI({ apiKey })
  const systemPrompt = buildSystemPrompt(mode, instruction)
  const userPrompt =
    mode === "sql_draft"
      ? ["# 依頼", text.trim(), context.trim() ? `# コンテキスト\n${context.trim()}` : ""].filter(Boolean).join("\n\n")
      : [context.trim() ? `# コンテキスト\n${context.trim()}` : "", text.trim() ? `# 対象テキスト\n${text.trim()}` : ""]
          .filter(Boolean)
          .join("\n\n")

  const admin = createSupabaseAdmin()
  const logBase = {
    org_id: actor.orgId,
    user_id: actor.userId,
    mode,
    action: mode === "sql_draft" ? "sql_draft" : "text_edit",
    source,
    input_preview: trimForLog(text, 1200),
    context_preview: trimForLog(context, 1800),
    apply_target: applyTarget,
    meta,
  }

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    })

    const textOutput =
      response.output &&
      Array.isArray(response.output) &&
      response.output[0] &&
      "content" in response.output[0] &&
      Array.isArray(response.output[0].content)
        ? (response.output[0].content as Array<{ text?: { value?: string } }>).map((item) => item.text?.value ?? "").join("")
        : (response.output_text ?? "").toString()

    const resultKind = kindForMode(mode)
    await admin.from("ai_logs").insert({
      ...logBase,
      success: true,
      error_message: null,
      result_kind: resultKind,
      output_text: trimForLog(textOutput, 6000),
    })

    return NextResponse.json({
      result: {
        kind: resultKind,
        mode,
        text: textOutput,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await admin.from("ai_logs").insert({
      ...logBase,
      success: false,
      error_message: message,
      result_kind: null,
      output_text: null,
    })
    return NextResponse.json({ error: "AI の生成に失敗しました。しばらくしてから再試行してください。" }, { status: 500 })
  }
}
