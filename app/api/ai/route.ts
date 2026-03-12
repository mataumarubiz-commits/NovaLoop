import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Mode = "summarize" | "rewrite" | "format" | "headings" | "sql_draft" | "procedure"

type RequestBody = {
  mode?: Mode
  instruction?: string
  text?: string
  context?: string
}

async function getUserAndOrg(req: NextRequest): Promise<{ userId: string; orgId: string; role: string } | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const {
    data: { user },
  } = await supabase.auth.getUser(token)
  if (!user) return null

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return null

  const { data: appUser } = await admin
    .from("app_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle()
  const role = (appUser as { role?: string } | null)?.role ?? "member"

  return { userId: user.id, orgId, role }
}

function buildSystemPrompt(mode: Mode, customInstruction?: string): string {
  if (mode === "sql_draft") {
    return [
      "You are a careful SQL assistant for Supabase/PostgreSQL.",
      "You ONLY output SQL, no explanations.",
      "Never run or modify data yourself. Only propose a safe SQL draft.",
      "Prefer idempotent, additive migrations when changing schema.",
      customInstruction?.trim() ? `Additional instruction: ${customInstruction.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  }

  const base =
    "You are a Japanese writing assistant for internal docs. Respond in Japanese unless the input is clearly another language."

  const map: Record<Mode, string> = {
    summarize: `${base}\nSummarize the given text in a concise, easy-to-skim way.`,
    rewrite: `${base}\nRewrite the text to be clearer and more natural, keeping the original meaning.`,
    format: `${base}\nReformat the text for readability: add line breaks, lists, and headings as appropriate.`,
    headings: `${base}\nExtract or generate good headings and outline structure for the text.`,
    procedure: `${base}\nConvert the given text into a clear step-by-step procedure (手順). Use numbered steps and imperative form. Output only the procedure text, no preamble.`,
    sql_draft: "", // handled above
  }

  const basePrompt = map[mode] ?? base
  return [basePrompt, customInstruction?.trim() ? `Additional instruction: ${customInstruction.trim()}` : ""]
    .filter(Boolean)
    .join("\n")
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

  const mode: Mode = (body.mode as Mode) || "summarize"
  const instruction = body.instruction ?? ""
  const text = body.text ?? ""
  const context = body.context ?? ""

  if (!text.trim() && !context.trim()) {
    return NextResponse.json({ error: "text or context is required" }, { status: 400 })
  }

  const user = await getUserAndOrg(req)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const isEditMode = mode === "rewrite" || mode === "format" || mode === "headings" || mode === "procedure"
  if (user.role === "member" && isEditMode) {
    return NextResponse.json({ error: "編集系AIはメンバー権限では利用できません。" }, { status: 403 })
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest"
  const client = new OpenAI({ apiKey })

  const systemPrompt = buildSystemPrompt(mode, instruction)
  const userPrompt =
    mode === "sql_draft"
      ? [`# 要件`, text.trim(), context.trim() ? `# コンテキスト\n${context.trim()}` : ""].filter(Boolean).join("\n\n")
      : [
          context.trim() ? `# コンテキスト\n${context.trim()}` : "",
          text.trim() ? `# 対象テキスト\n${text.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")

  const admin = createSupabaseAdmin()
  const logBase = {
    org_id: user.orgId,
    user_id: user.userId,
    mode,
    action: mode === "sql_draft" ? "sql_draft" : "text_edit",
  }

  try {
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    })

    const textOutput =
      response.output &&
      "text" in response.output[0] &&
      response.output[0].type === "message" &&
      "content" in response.output[0]
        ? (response.output[0].content as Array<{ text?: { value?: string } }>).map((c) => c.text?.value ?? "").join("")
        : (response.output_text ?? "").toString()

    await admin.from("ai_logs").insert({
      ...logBase,
      success: true,
      error_message: null,
    })

    return NextResponse.json({ result: textOutput })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await admin.from("ai_logs").insert({
      ...logBase,
      success: false,
      error_message: message,
    })
    return NextResponse.json({ error: "AI呼び出しに失敗しました。しばらくしてから再試行してください。" }, { status: 500 })
  }
}

