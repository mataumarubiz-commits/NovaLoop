type TemplateMark = {
  type: string
  attrs?: Record<string, unknown>
}

export type TemplateDocNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TemplateDocNode[]
  text?: string
  marks?: TemplateMark[]
}

export type TemplatePageType = "doc" | "checklist" | "snippets" | "table_like" | "link_hub"

export type TemplateCategory =
  | "core_ops"
  | "people_ops"
  | "content_intake"
  | "quality"
  | "notification"
  | "client_ops"

export type OfficialTemplatePageSeed = {
  key: string
  parentPageKey: string | null
  slugSeed: string
  title: string
  icon: string | null
  orderIndex: number
  pageType: TemplatePageType
  content: TemplateDocNode
}

export type OfficialTemplateCatalogSeed = {
  key: string
  name: string
  description: string
  improvementText: string
  category: TemplateCategory
  badges: string[]
  isOfficial: boolean
  sortOrder: number
  previewImagePath: string | null
  version: string
  status: "active" | "archived"
  integrationTargets: string[]
  recommendedTemplateKeys?: string[]
  pages: OfficialTemplatePageSeed[]
}

export type TemplatePreviewPayload = {
  headline: string
  summary: string
  highlightedPages: string[]
  textPreview: string[]
}

function textNode(text: string, marks?: TemplateMark[]): TemplateDocNode {
  if (marks && marks.length > 0) {
    return { type: "text", text, marks }
  }
  return { type: "text", text }
}

function linkText(label: string, href: string): TemplateDocNode {
  return textNode(label, [{ type: "link", attrs: { href } }])
}

function paragraph(...parts: Array<string | TemplateDocNode>): TemplateDocNode {
  const content = parts.map((part) => (typeof part === "string" ? textNode(part) : part))
  return { type: "paragraph", content }
}

function heading(level: 1 | 2 | 3, text: string): TemplateDocNode {
  return { type: "heading", attrs: { level }, content: [textNode(text)] }
}

function listItem(text: string): TemplateDocNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [textNode(text)] }],
  }
}

function bullet(items: string[]): TemplateDocNode {
  return { type: "bulletList", content: items.map(listItem) }
}

function ordered(items: string[]): TemplateDocNode {
  return {
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map(listItem),
  }
}

function task(items: string[]): TemplateDocNode {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [{ type: "paragraph", content: [textNode(item)] }],
    })),
  }
}

function quote(text: string): TemplateDocNode {
  return { type: "blockquote", content: [paragraph(text)] }
}

function codeBlock(text: string, language = "text"): TemplateDocNode {
  return { type: "codeBlock", attrs: { language }, content: [textNode(text)] }
}

function doc(...nodes: TemplateDocNode[]): TemplateDocNode {
  return { type: "doc", content: nodes }
}

function routeHub(title: string, items: Array<{ label: string; href: string; note: string }>): TemplateDocNode {
  const nodes: TemplateDocNode[] = [heading(1, title)]
  for (const item of items) {
    nodes.push(paragraph(linkText(item.label, item.href)))
    nodes.push(paragraph(item.note))
  }
  return doc(...nodes)
}

export function templateCategoryLabel(category: TemplateCategory): string {
  switch (category) {
    case "core_ops":
      return "コア運用"
    case "people_ops":
      return "人員運用"
    case "content_intake":
      return "案件入力支援"
    case "quality":
      return "修正・品質管理"
    case "notification":
      return "連携・通知"
    case "client_ops":
      return "クライアント運用"
  }
}

export function templatePageTypeLabel(pageType: TemplatePageType): string {
  switch (pageType) {
    case "doc":
      return "ドキュメント"
    case "checklist":
      return "チェックリスト"
    case "snippets":
      return "スニペット集"
    case "table_like":
      return "台帳"
    case "link_hub":
      return "導線ハブ"
  }
}

export function extractPlainTextFromTemplateDoc(node: TemplateDocNode | null | undefined): string {
  if (!node) return ""
  if (node.type === "text" && typeof node.text === "string") return node.text
  if (!Array.isArray(node.content)) return ""
  return node.content.map((child) => extractPlainTextFromTemplateDoc(child)).join(" ")
}

function replaceTextTokensInNode(
  node: TemplateDocNode,
  replacements: Record<string, string>
): TemplateDocNode {
  const next: TemplateDocNode = { type: node.type }
  if (node.attrs) next.attrs = { ...node.attrs }
  if (typeof node.text === "string") {
    let text = node.text
    for (const [token, value] of Object.entries(replacements)) {
      text = text.split(token).join(value)
    }
    next.text = text
  }
  if (node.marks) {
    next.marks = node.marks.map((mark) => ({
      ...mark,
      attrs: mark.attrs ? { ...mark.attrs } : undefined,
    }))
  }
  if (node.content) {
    next.content = node.content.map((child) => replaceTextTokensInNode(child, replacements))
  }
  return next
}

export function applyTemplateReplacements(
  node: TemplateDocNode,
  replacements: Record<string, string>
): TemplateDocNode {
  return replaceTextTokensInNode(node, replacements)
}

export function buildTemplatePreviewPayload(seed: OfficialTemplateCatalogSeed): TemplatePreviewPayload {
  const overviewPage = seed.pages.find((page) => page.parentPageKey === null) ?? seed.pages[0]
  const highlightedPages = seed.pages
    .slice(0, 4)
    .map((page) => page.title)
  const textPreview = seed.pages
    .slice(0, 3)
    .map((page) => extractPlainTextFromTemplateDoc(page.content).replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .map((text) => (text.length > 120 ? `${text.slice(0, 120)}...` : text))

  return {
    headline: `${seed.name} Preview`,
    summary: extractPlainTextFromTemplateDoc(overviewPage.content).replace(/\s+/g, " ").trim().slice(0, 180),
    highlightedPages,
    textPreview,
  }
}

export function buildBlankTemplateContent(title: string, pageType: TemplatePageType): TemplateDocNode {
  if (pageType === "checklist") {
    return doc(
      heading(1, title),
      paragraph("空欄版です。チーム用の確認項目をこのページへ追加してください。"),
      task(["確認項目を追加する", "完了条件を明記する", "運用メモを残す"])
    )
  }

  if (pageType === "snippets") {
    return doc(
      heading(1, title),
      paragraph("空欄版です。よく使う文面やコピーテンプレを追加してください。"),
      heading(2, "テンプレ 01"),
      codeBlock("ここに文面テンプレを入力"),
      heading(2, "テンプレ 02"),
      codeBlock("ここに別パターンを入力")
    )
  }

  if (pageType === "table_like") {
    return doc(
      heading(1, title),
      paragraph("空欄版です。台帳として使う列や見出しをこのページに整理してください。"),
      codeBlock("項目 | 役割 | メモ\nサンプル | owner | ここを編集")
    )
  }

  if (pageType === "link_hub") {
    return doc(
      heading(1, title),
      paragraph("空欄版です。関連画面や外部リンクをこのページに集約してください。"),
      paragraph(linkText("案件を開く", "/projects")),
      paragraph("運用に必要な本体画面や資料リンクを追加します。")
    )
  }

  return doc(
    heading(1, title),
    paragraph("空欄版です。チームで使うルールや手順をこのページへ追記してください。"),
    heading(2, "目的"),
    paragraph("このページで何を標準化するかを一文で書く。"),
    heading(2, "運用ルール"),
    bullet(["入力担当を決める", "完了条件を決める", "例外時の連絡先を書く"])
  )
}

export const OFFICIAL_TEMPLATE_CATALOG: OfficialTemplateCatalogSeed[] = [
  // ──────────────────────────────────────────────
  // 1. 案件運用OS（旧: editing_direction_os + content_intake_rules + monthly_recurring_input）
  // ──────────────────────────────────────────────
  {
    key: "project_ops_os",
    name: "案件運用OS",
    description: "案件の登録・進行・納品・月次定例までを一気通貫で標準化する統合パックです。",
    improvementText: "案件登録の命名ルール、進行フロー、修正指示、納期管理、月次定例の入力まで、バラバラだった運用をひとつの型に統合します。",
    category: "core_ops",
    badges: ["公式", "統合パック", "1クリック導入"],
    isOfficial: true,
    sortOrder: 10,
    previewImagePath: null,
    version: "2.0.0",
    status: "active",
    integrationTargets: ["/projects", "/notifications", "/settings/members", "/billing", "/vendors", "/payouts"],
    recommendedTemplateKeys: ["team_resource_os", "quality_os", "client_ops_os"],
    pages: [
      {
        key: "overview",
        parentPageKey: null,
        slugSeed: "project-ops-os",
        title: "案件運用OS",
        icon: "PO",
        orderIndex: 0,
        pageType: "doc",
        content: doc(
          heading(1, "{{install_name}}"),
          paragraph("案件の登録から納品・月次定例まで、運用の型をひとつに統合した公式パックです。案件実体は ", linkText("案件画面", "/projects"), " に集約し、このパックではルールと判断基準だけを整えます。"),
          quote("正式な案件データのソースは常に案件画面。Pages はルールと判断基準の OS。"),
          heading(2, "含まれるページ"),
          bullet([
            "01_全体フロー — 依頼から納品までの共通手順",
            "02_役割定義 — 担当ごとの責任範囲と完了条件",
            "03_ステータス運用ガイド — status の意味づけと遷移ルール",
            "04_案件登録ルール — 命名・必須リンク・担当割当の型",
            "05_コピペ雛形 — 新規・定例案件の入力テンプレ",
            "06_月次定例運用 — 毎月の定例案件の複製と差分管理",
            "07_納期の決め方 — 逆算ルールとチェックリスト",
            "08_緊急対応ルール — 例外時の導線と対応手順",
          ]),
          heading(2, "本体画面との接続"),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("通知センターを開く", "/notifications")),
          paragraph(linkText("メンバー権限を確認する", "/settings/members")),
          paragraph(linkText("請求管理を開く", "/billing"))
        ),
      },
      {
        key: "flow",
        parentPageKey: "overview",
        slugSeed: "project-ops-flow",
        title: "01_全体フロー",
        icon: "01",
        orderIndex: 10,
        pageType: "doc",
        content: doc(
          heading(1, "全体フロー"),
          paragraph("案件登録は案件画面を正式ソースにして進めます。Pages 側ではフロー説明だけを持ちます。"),
          ordered(["依頼情報を案件画面に登録する", "担当編集者と確認者を割り当てる", "素材リンクと期限を確認する", "初稿確認と修正指示を回す", "納品完了後に請求対象へつなぐ"]),
          heading(2, "着手前に確認すること"),
          task(["タイトルと命名規則が合っている", "素材リンクが揃っている", "due_client_at と due_editor_at が妥当", "クライアント固有ルールを確認した"]),
          heading(2, "例外時の扱い"),
          bullet(["納期変更は案件画面の日付を先に更新する", "担当変更は案件画面の担当列を先に更新する", "Pages には変更理由や運用メモだけを残す"])
        ),
      },
      {
        key: "roles",
        parentPageKey: "overview",
        slugSeed: "project-ops-roles",
        title: "02_役割定義",
        icon: "02",
        orderIndex: 20,
        pageType: "table_like",
        content: doc(
          heading(1, "役割定義"),
          paragraph("誰が次に動くかを曖昧にしないための役割表です。"),
          codeBlock(
            "役割 | 主責任 | 受け取る情報 | 終了条件\n" +
              "ディレクター | 依頼整理・品質判断 | クライアント要件、素材リンク | 修正指示が明確\n" +
              "編集者 | 制作と一次修正 | 指示テンプレ、素材、納期 | 納品可能な状態で戻す\n" +
              "確認者 | 初稿チェック | 初稿、チェック観点 | OK / 差し戻し判断が済む",
            "text"
          ),
          heading(2, "役割分担のルール"),
          bullet(["役割名はチーム内で統一する", "曖昧な仕事は完了条件で切る", "例外案件だけ別ルールを追記する"])
        ),
      },
      {
        key: "status-guide",
        parentPageKey: "overview",
        slugSeed: "project-ops-status-guide",
        title: "03_ステータス運用ガイド",
        icon: "03",
        orderIndex: 30,
        pageType: "table_like",
        content: doc(
          heading(1, "ステータス運用ガイド"),
          paragraph("status の実保存は案件画面側で行います。このページは意味づけと完了条件だけを定義します。"),
          codeBlock(
            "status | チーム内の意味 | 次に動く人 | 完了条件\n" +
              "draft | 着手前整理中 | ディレクター | 素材と依頼文が揃う\n" +
              "working | 編集中 | 編集者 | 初稿提出できる\n" +
              "review | 確認中 | 確認者 | OK か修正依頼かが決まる\n" +
              "delivered | 納品完了 | ディレクター | delivery_month が確定する",
            "text"
          ),
          heading(2, "詰まりやすい点"),
          bullet(["review に長く滞留したら確認担当を固定する", "素材不足は draft のまま止める", "納品完了前に請求対象扱いしない"])
        ),
      },
      {
        key: "intake-rules",
        parentPageKey: "overview",
        slugSeed: "project-ops-intake-rules",
        title: "04_案件登録ルール",
        icon: "04",
        orderIndex: 40,
        pageType: "doc",
        content: doc(
          heading(1, "案件登録ルール"),
          heading(2, "命名規則"),
          bullet([
            "client / project_name / title は検索しやすい単位で分ける",
            "月次定例は YYYY-MM を project_name か title に含める",
            "同名案件が並ぶときは媒体や尺で識別する",
          ]),
          quote("例: ClientA / 2026-03 Shorts / 30秒比較動画"),
          heading(2, "必須リンク整理"),
          task([
            "素材置き場リンクがある",
            "参考動画または参考投稿リンクがある",
            "納品先 URL または提出方法がある",
            "クライアントの確認観点が記載されている",
          ]),
          heading(2, "担当割当ルール"),
          bullet([
            "編集者は得意ジャンルと稼働余力で決める",
            "確認者はクライアント相性と返信速度で決める",
            "割当後は案件画面に更新し、このページには判断基準だけを残す",
          ]),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("メンバー権限を確認する", "/settings/members"))
        ),
      },
      {
        key: "copy-templates",
        parentPageKey: "overview",
        slugSeed: "project-ops-copy-templates",
        title: "05_コピペ雛形",
        icon: "05",
        orderIndex: 50,
        pageType: "snippets",
        content: doc(
          heading(1, "コピペ雛形"),
          heading(2, "初回登録用"),
          codeBlock("案件名:\nクライアント:\n提出日:\n素材リンク:\n参考リンク:\n注意点:"),
          heading(2, "定例案件用"),
          codeBlock("案件名:\n今月の変化点:\n前月との差分:\n素材追加:\n確認担当:"),
          heading(2, "修正指示テンプレ"),
          codeBlock("00:12 〜 00:16\nテロップを 2 行に分けて可読性を上げてください。\n完了条件: スマホ表示でも 2 行以内で読める。"),
          heading(2, "差し戻し時のひとこと"),
          codeBlock("修正箇所は 3 点です。優先度順に並べているので、上から反映をお願いします。")
        ),
      },
      {
        key: "monthly-recurring",
        parentPageKey: "overview",
        slugSeed: "project-ops-monthly-recurring",
        title: "06_月次定例運用",
        icon: "06",
        orderIndex: 60,
        pageType: "doc",
        content: doc(
          heading(1, "月次定例運用"),
          paragraph("月次定例案件の入力品質を揃え、前月コピーの抜け漏れを仕組みで防ぎます。"),
          heading(2, "月次定例案件の作り方"),
          ordered([
            "前月の案件名と納品日を確認する",
            "今月の project_name と title の差分を決める",
            "delivery_month と提出日を更新する",
            "素材リンクと参考リンクの差分を差し替える",
          ]),
          heading(2, "連番ルール"),
          bullet([
            "同月内では同じ粒度で連番を振る",
            "媒体違いは suffix を付ける",
            "定例番号は title か project_name のどちらか一方へ寄せる",
          ]),
          heading(2, "今月差分メモ"),
          codeBlock("前月との差分は 1. 納期 2. 素材 3. CTA です。ここだけ先に更新してください。")
        ),
      },
      {
        key: "deadline-rules",
        parentPageKey: "overview",
        slugSeed: "project-ops-deadline-rules",
        title: "07_納期の決め方",
        icon: "07",
        orderIndex: 70,
        pageType: "checklist",
        content: doc(
          heading(1, "納期の決め方"),
          task([
            "先方提出日をまず確定する",
            "due_editor_at は先方提出日から逆算する",
            "祝日や大型連休の影響を確認する",
            "レビュー担当の稼働日を見てずらす",
          ])
        ),
      },
      {
        key: "emergency-flow",
        parentPageKey: "overview",
        slugSeed: "project-ops-emergency-flow",
        title: "08_緊急対応ルール",
        icon: "08",
        orderIndex: 80,
        pageType: "link_hub",
        content: routeHub("緊急対応ルール", [
          { label: "案件管理へ", href: "/projects", note: "期限超過や担当変更が発生したら、まず案件画面の期限と担当を更新します。" },
          { label: "通知センターへ", href: "/notifications", note: "優先対応の通知をまとめて確認します。" },
          { label: "メンバー設定へ", href: "/settings/members", note: "担当調整や権限確認が必要なときの正式導線です。" },
        ]),
      },
    ],
  },
  // ──────────────────────────────────────────────
  // 2. チームリソースOS（旧: member_resource_management + editor_registry + director_registry）
  // ──────────────────────────────────────────────
  {
    key: "team_resource_os",
    name: "チームリソースOS",
    description: "メンバー台帳・稼働管理・編集者/ディレクターのスキルと相性を統合管理します。",
    improvementText: "アサインのたびに聞き回る手間をなくし、台帳・稼働・スキル・相性をひとつの型で共有します。",
    category: "people_ops",
    badges: ["公式", "統合パック", "1クリック導入"],
    isOfficial: true,
    sortOrder: 20,
    previewImagePath: null,
    version: "2.0.0",
    status: "active",
    integrationTargets: ["/settings/members", "/projects", "/vendors", "/payouts", "/notifications"],
    recommendedTemplateKeys: ["project_ops_os", "quality_os", "client_ops_os"],
    pages: [
      {
        key: "overview",
        parentPageKey: null,
        slugSeed: "team-resource-os",
        title: "チームリソースOS",
        icon: "TR",
        orderIndex: 0,
        pageType: "doc",
        content: doc(
          heading(1, "{{install_name}}"),
          paragraph("組織メンバーの正式な権限は ", linkText("/settings/members", "/settings/members"), " がソースです。このパックではアサイン判断に必要な運用情報をすべて統合します。"),
          heading(2, "含まれるページ"),
          bullet([
            "01_メンバー台帳 — 基本属性と連絡上の注意",
            "02_稼働条件表 — 稼働枠と受入可否",
            "03_稼働管理 — チーム全体の稼働状況一覧",
            "04_得意領域表 — メンバーごとの強み・注意点",
            "05_スキル・ソフト表 — ソフト習熟度の一覧",
            "06_編集者依頼ガイド — 依頼時の注意点と品質メモ",
            "07_ディレクター運用ガイド — レビュー担当の相性と優先順位",
            "08_アサイン判断メモ — 割当の判断基準とビュー設定",
          ]),
          heading(2, "使いどころ"),
          bullet(["誰に依頼するか迷うとき", "稼働量の偏りを見直すとき", "クライアント相性や注意点を引き継ぐとき"])
        ),
      },
      {
        key: "member-ledger",
        parentPageKey: "overview",
        slugSeed: "team-resource-ledger",
        title: "01_メンバー台帳",
        icon: "01",
        orderIndex: 10,
        pageType: "table_like",
        content: doc(
          heading(1, "メンバー台帳"),
          paragraph("稼働管理の元台帳です。メンバーの基本属性と連絡上の注意をまとめます。"),
          codeBlock(
            "No | お名前 | ポジション | 形態 | 稼働時間帯 | 使用ソフト | 備考\n" +
              "1 | 元井 亮 | editor | 専業 | 平日 10:00-19:00 | Premiere / CapCut | 短尺が速い\n" +
              "2 | 齋藤 ありこ | editor | 専業 | 平日 10:00-18:00 | Premiere / After Effects | モーション演出に強い\n" +
              "3 | 中村 竜弘 | director | 専業 | 平日 9:00-18:00 | Notion / Figma | 初稿確認の返答が速い\n" +
              "4 | 鈴木 悠斗 | editor | 専業 | 平日 11:00-20:00 | CapCut | 納期前日に進捗確認を送る\n" +
              "5 | 高橋 優香 | director | 専業 | 平日 10:00-19:00 | Notion | ブランドトーン判定が正確",
            "text"
          )
        ),
      },
      {
        key: "availability",
        parentPageKey: "overview",
        slugSeed: "team-resource-availability",
        title: "02_稼働条件表",
        icon: "02",
        orderIndex: 20,
        pageType: "table_like",
        content: doc(
          heading(1, "稼働条件表"),
          paragraph("各メンバーの稼働枠と受入可否の一覧です。正式な案件割当は案件画面で管理します。"),
          codeBlock(
            "No | お名前 | 形態 | ステータス | 新規 | 週上限 | 稼働時間帯 | 休止・備考\n" +
              "1 | 元井 亮 | 専業 | 案件対応中 | 可 | 6 本 | 平日 10:00-19:00 | 月末は埋まりやすい\n" +
              "2 | 齋藤 ありこ | 専業 | 案件対応中 | 可 | 5 本 | 平日 10:00-18:00 | 水曜午前は会議固定\n" +
              "3 | 中村 竜弘 | 専業 | 案件対応予定 | — | 8 本 | 平日 9:00-18:00 | 来週から復帰\n" +
              "4 | 鈴木 悠斗 | 専業 | 案件対応中 | 可 | 4 本 | 平日 11:00-20:00 | 夜間対応相談可\n" +
              "5 | 高橋 優香 | 専業 | 案件対応予定 | — | 6 本 | 平日 10:00-19:00 | 4月上旬に長期休暇",
            "text"
          ),
          heading(2, "ステータスの意味"),
          bullet([
            "案件対応中: 現在アクティブに案件を受けている",
            "案件対応予定: 近日中にアサイン可能だが、現在は空き",
            "待機中: チーム内作業のみ、新規案件は受けない",
          ])
        ),
      },
      {
        key: "capacity-view",
        parentPageKey: "overview",
        slugSeed: "team-resource-capacity-view",
        title: "03_稼働管理",
        icon: "03",
        orderIndex: 30,
        pageType: "table_like",
        content: doc(
          heading(1, "稼働管理"),
          paragraph("チーム全体の稼働状況を一覧で把握するためのビューです。アサイン判断や偏りの確認に使います。"),
          codeBlock(
            "No | お名前 | ポジション | 形態 | 稼働時間帯 | ステータス | 新規 | スケジュール | 備考 | 今週担当数 | 空き枠\n" +
              "1 | 元井 亮 | editor | 専業 | 平日 10:00-19:00 | 案件対応中 | 可 | — | — | 4 本 | 2 枠\n" +
              "2 | 齋藤 ありこ | editor | 専業 | 平日 10:00-18:00 | 案件対応中 | 可 | — | — | 3 本 | 2 枠\n" +
              "3 | 中村 竜弘 | director | 専業 | 平日 9:00-18:00 | 案件対応予定 | — | 4/1〜 | 来週復帰 | 0 本 | —\n" +
              "4 | 鈴木 悠斗 | editor | 専業 | 平日 11:00-20:00 | 案件対応中 | 可 | — | — | 3 本 | 1 枠\n" +
              "5 | 高橋 優香 | director | 専業 | 平日 10:00-19:00 | 案件対応予定 | — | — | 4月上旬休暇 | 5 本 | 1 枠\n" +
              "6 | 大賀 みさと | editor | 専業 | 平日 10:00-19:00 | 案件対応中 | 可 | — | — | 2 本 | 4 枠\n" +
              "7 | 宮崎 隼 | editor | 専業 | 平日 9:00-18:00 | 案件対応予定 | — | — | — | 0 本 | 6 枠\n" +
              "8 | 松丸 煌明 | editor | 副業 | 平日 19:00-23:00 | 案件対応中 | — | — | 夜間のみ | 2 本 | 1 枠",
            "text"
          ),
          heading(2, "この表の使い方"),
          bullet([
            "「空き枠」が多い人から優先的にアサインを検討する",
            "「新規: 可」のメンバーだけが新規案件を受けられる",
            "ステータスが「案件対応予定」の人はスケジュール列で開始日を確認する",
            "正式な担当割当は案件画面に反映し、この表では状況の把握だけを行う",
          ]),
          heading(2, "2週間カレンダーの見方"),
          paragraph("右側の日付列には、その日にアサインされた案件数や予定を入れます。色分けの目安:"),
          bullet([
            "空欄: 空き",
            "数字: その日の担当案件数",
            "休: 休暇・稼働不可",
          ]),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("メンバー設定を開く", "/settings/members"))
        ),
      },
      {
        key: "specialties",
        parentPageKey: "overview",
        slugSeed: "team-resource-specialties",
        title: "04_得意領域表",
        icon: "04",
        orderIndex: 40,
        pageType: "table_like",
        content: doc(
          heading(1, "得意領域表"),
          paragraph("アサイン判断のときに参照する、メンバーごとの強み・注意点の一覧です。"),
          codeBlock(
            "No | お名前 | ポジション | 得意案件 | 苦手案件 | 相性の良いクライアント | 備考\n" +
              "1 | 元井 亮 | editor | テロップ多めの短尺 | 長尺密着 | A 社 | 仕上がりが速い、修正指示は具体的に\n" +
              "2 | 齋藤 ありこ | editor | モーション演出 | 素材整理が多い案件 | B 社 | After Effects の作り込みが丁寧\n" +
              "3 | 中村 竜弘 | director | 品質確認・構成調整 | 量産短尺 | A 社 | 初稿戻しの判断が明快\n" +
              "4 | 鈴木 悠斗 | editor | 広告クリエイティブ | ブランド長尺 | C 社 | CTA の切り口が強い\n" +
              "5 | 高橋 優香 | director | トーン判定・CTA 調整 | 緊急対応 | B 社 | クライアント折衝が安定する",
            "text"
          )
        ),
      },
      {
        key: "tool-skill",
        parentPageKey: "overview",
        slugSeed: "team-resource-tool-skill",
        title: "05_スキル・ソフト表",
        icon: "05",
        orderIndex: 50,
        pageType: "table_like",
        content: doc(
          heading(1, "スキル・ソフト表"),
          codeBlock(
            "名前 | Premiere | After Effects | CapCut | サムネ対応 | 補足\n" +
              "元井 亮 | 上級 | 中級 | 上級 | 可 | スピード優先案件向け\n" +
              "齋藤 ありこ | 中級 | 上級 | 中級 | 不可 | モーション演出に強い\n" +
              "鈴木 悠斗 | 中級 | 初級 | 上級 | 可 | 広告クリエイティブが得意",
            "text"
          )
        ),
      },
      {
        key: "editor-guide",
        parentPageKey: "overview",
        slugSeed: "team-resource-editor-guide",
        title: "06_編集者依頼ガイド",
        icon: "06",
        orderIndex: 60,
        pageType: "doc",
        content: doc(
          heading(1, "編集者依頼ガイド"),
          heading(2, "編集者一覧"),
          codeBlock(
            "名前 | 担当可能本数 | 主要ジャンル | 返信速度 | 備考\n" +
              "元井 亮 | 6 | short / ad | 速い | 依頼文は箇条書きが伝わりやすい\n" +
              "齋藤 ありこ | 5 | motion / long | 普通 | 素材整理済みだと強い\n" +
              "鈴木 悠斗 | 4 | ad / creative | 速い | CTA の切り口が強い",
            "text"
          ),
          heading(2, "品質メモ"),
          bullet([
            "誰でも読める言葉で残す",
            "人格評価ではなく、仕上がり傾向と対応パターンを書く",
            "改善した点も追記し、古い印象だけで判断しない",
          ]),
          quote("例: テロップの可読性は高い。構成変更があるときは指示を細かく書くと安定する。"),
          heading(2, "依頼時の定型文"),
          codeBlock("素材リンク / 指示 / 期限 / 参考動画の順で送ります。判断が必要な点だけ先にまとめています。"),
          codeBlock("初稿で特に見たいのは 1. 尺 2. トーン 3. CTA です。ここだけ最優先で揃えてください。")
        ),
      },
      {
        key: "director-guide",
        parentPageKey: "overview",
        slugSeed: "team-resource-director-guide",
        title: "07_ディレクター運用ガイド",
        icon: "07",
        orderIndex: 70,
        pageType: "doc",
        content: doc(
          heading(1, "ディレクター運用ガイド"),
          heading(2, "ディレクター一覧"),
          codeBlock(
            "名前 | 主担当領域 | 得意な判断 | クライアント相性 | 補足\n" +
              "中村 竜弘 | review / quality | 修正整理と優先順位付け | A 社 | 初稿戻しの判断が明快\n" +
              "高橋 優香 | flow / escalation | CTA とトーン調整 | B 社 | クライアント折衝が安定する",
            "text"
          ),
          heading(2, "初稿確認担当ルール"),
          bullet([
            "ブランドトーンが重い案件は相性優先で担当を決める",
            "緊急案件は返信速度を優先する",
            "レビュー観点が特殊な案件はクライアント運用OSを先に確認する",
          ]),
          heading(2, "クライアント相性メモ"),
          codeBlock(
            "クライアント | 相性の良い担当 | 理由 | 引き継ぎメモ\n" +
              "A 社 | 中村 | 修正整理が得意 | CTA の語尾に注意\n" +
              "B 社 | 高橋 | トーンの判定が近い | 緊急時は通知を先に飛ばす",
            "text"
          ),
          heading(2, "優先順位ルール"),
          ordered(["納期遅延リスクが高い案件", "確認待ちで止まっている案件", "クライアント返信が必要な案件", "今月請求に乗る案件"]),
          paragraph("優先順位を変えたら、理由は Pages に、実際の担当や期限変更は案件画面に残します。")
        ),
      },
      {
        key: "assignment-memo",
        parentPageKey: "overview",
        slugSeed: "team-resource-assignment-memo",
        title: "08_アサイン判断メモ",
        icon: "08",
        orderIndex: 80,
        pageType: "doc",
        content: doc(
          heading(1, "アサイン判断メモ"),
          bullet([
            "納期が短い案件は、稼働量よりも修正往復の少なさを優先する",
            "クライアントごとの言葉遣い差分は Pages のクライアント運用OSを先に確認する",
            "担当を決めたら案件画面に反映し、このページには判断理由だけを残す",
          ]),
          heading(2, "編集者ビュー設定"),
          bullet([
            "今日の担当案件、締切、必要素材だけを先に表示する",
            "請求や支払の数値は隠し、進行に必要なリンクだけを残す",
            "外注依頼がある案件は /vendors への導線を必ず見える位置に置く",
          ]),
          heading(2, "ディレクタービュー設定"),
          bullet([
            "レビュー待ちと差し戻し対応を同時に見える順で並べる",
            "品質メモとクライアント注意点を1画面で見返せるようにする",
            "通知確認と案件画面のレビュー対象だけを先に開ける導線を置く",
          ]),
          paragraph(linkText("メンバー設定を開く", "/settings/members")),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("通知を開く", "/notifications"))
        ),
      },
    ],
  },
  // ──────────────────────────────────────────────
  // 3. 品質管理OS（旧: revision_snippets + first_draft_checkpoints）
  // ──────────────────────────────────────────────
  {
    key: "quality_os",
    name: "品質管理OS",
    description: "修正指示の型と初稿チェック観点を統合し、品質のバラつきをなくします。",
    improvementText: "「なんか違う」で終わる修正指示を型に変え、初稿チェックの抜け漏れを観点別に防ぎます。",
    category: "quality",
    badges: ["公式", "統合パック", "1クリック導入"],
    isOfficial: true,
    sortOrder: 30,
    previewImagePath: null,
    version: "2.0.0",
    status: "active",
    integrationTargets: ["/projects", "/notifications"],
    recommendedTemplateKeys: ["project_ops_os", "team_resource_os", "client_ops_os"],
    pages: [
      {
        key: "overview",
        parentPageKey: null,
        slugSeed: "quality-os",
        title: "品質管理OS",
        icon: "QA",
        orderIndex: 0,
        pageType: "doc",
        content: doc(
          heading(1, "{{install_name}}"),
          paragraph("修正指示と初稿チェックを統合した品質管理パックです。確認者ごとの観点のバラつきをなくし、修正指示の速度と質を同時に上げます。"),
          heading(2, "含まれるページ"),
          bullet([
            "01_初稿チェック総合 — 全観点を1ページで確認",
            "02_テロップ・テンポ — 映像品質のチェック項目",
            "03_BGM・SE・ブランドトーン — 音声と表現のチェック項目",
            "04_秒数指定テンプレ — タイムコード付き修正指示",
            "05_文言テンプレ — よく使う修正表現集",
            "06_NG / 良い例 — 修正指示のアンチパターンと良例",
          ]),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("通知を開く", "/notifications"))
        ),
      },
      {
        key: "first-draft-all",
        parentPageKey: "overview",
        slugSeed: "quality-os-first-draft-all",
        title: "01_初稿チェック総合",
        icon: "01",
        orderIndex: 10,
        pageType: "checklist",
        content: doc(
          heading(1, "初稿チェック総合"),
          paragraph("初稿確認の抜け漏れを減らすための共通チェックです。詳細は個別ページで確認します。"),
          task([
            "冒頭 3 秒でテーマが伝わる",
            "テロップの誤字と改行位置に違和感がない",
            "BGM / SE の音量がナレーションを邪魔しない",
            "CTA の内容と導線先が一致している",
            "ブランドトーンが既存案件とずれていない",
            "尺が要件どおりに収まっている",
          ])
        ),
      },
      {
        key: "telop-tempo",
        parentPageKey: "overview",
        slugSeed: "quality-os-telop-tempo",
        title: "02_テロップ・テンポ",
        icon: "02",
        orderIndex: 20,
        pageType: "checklist",
        content: doc(
          heading(1, "テロップ・テンポ"),
          heading(2, "テロップ"),
          task([
            "誤字脱字がない",
            "1 行あたりの情報量が重すぎない",
            "スマホ表示で読めるサイズになっている",
            "言い切り方がブランドトーンに合っている",
          ]),
          heading(2, "テンポ・尺"),
          task([
            "冒頭 3 秒でテーマが伝わる",
            "話の流れが急に飛んでいない",
            "尺が要件どおりに収まっている",
            "間延びする区間がない",
          ])
        ),
      },
      {
        key: "audio-brand",
        parentPageKey: "overview",
        slugSeed: "quality-os-audio-brand",
        title: "03_BGM・SE・ブランドトーン",
        icon: "03",
        orderIndex: 30,
        pageType: "checklist",
        content: doc(
          heading(1, "BGM・SE・ブランドトーン"),
          heading(2, "BGM・SE"),
          task([
            "ナレーションやテロップを邪魔しない音量か",
            "雰囲気が案件トーンに合っているか",
            "SE が過剰に主張していないか",
            "ループや切り替えで違和感がないか",
          ]),
          heading(2, "ブランドトーン・CTA"),
          task([
            "既存投稿と並べても違和感がない",
            "言葉遣いがクライアントルールから外れていない",
            "CTA の内容とリンク先が一致している",
            "最後の一押しが強すぎない / 弱すぎない",
          ])
        ),
      },
      {
        key: "timecode-snippets",
        parentPageKey: "overview",
        slugSeed: "quality-os-timecode-snippets",
        title: "04_秒数指定テンプレ",
        icon: "04",
        orderIndex: 40,
        pageType: "snippets",
        content: doc(
          heading(1, "秒数指定テンプレ"),
          paragraph("秒数指定 + 変更意図 + 完了条件の順で伝えると、差し戻しが減ります。"),
          codeBlock("00:04 〜 00:07\n訴求が早すぎるので、結論を 1 テンポ遅らせてください。\n完了条件: 冒頭の理解負荷が下がる。"),
          codeBlock("00:12 〜 00:16\nテロップを 2 行に分けて可読性を上げてください。\n完了条件: スマホ表示でも 2 行以内で読める。"),
          codeBlock("00:18 〜 00:22\nテロップの改行位置を調整し、1 行あたりの情報量を減らしてください。"),
          heading(2, "トーン修正テンプレ"),
          codeBlock("全体の言い回しを断定寄りからやわらかめへ寄せてください。\n完了条件: クライアントの既存投稿と並べても違和感がない。")
        ),
      },
      {
        key: "wording-snippets",
        parentPageKey: "overview",
        slugSeed: "quality-os-wording-snippets",
        title: "05_文言テンプレ",
        icon: "05",
        orderIndex: 50,
        pageType: "snippets",
        content: doc(
          heading(1, "文言テンプレ"),
          heading(2, "方向性 OK 時"),
          codeBlock("方向性は良いです。以下 2 点だけ直るとそのまま提出できます。"),
          heading(2, "トーン調整時"),
          codeBlock("クライアントの意図は維持したまま、もう少しやわらかい言い回しへ寄せたいです。"),
          heading(2, "差し戻し時"),
          codeBlock("修正箇所は 3 点です。優先度順に並べているので、上から反映をお願いします。"),
          heading(2, "クライアント別言い換え"),
          codeBlock("強め表現: 『差し戻しです』\nやわらかめ: 『この 2 点だけ調整できると、より提出しやすいです。』"),
          codeBlock("社内向け: 『優先度は上から順です。』\n先方向け: 『まずは上から 2 点をご確認ください。』")
        ),
      },
      {
        key: "good-bad",
        parentPageKey: "overview",
        slugSeed: "quality-os-good-bad",
        title: "06_NG / 良い例",
        icon: "06",
        orderIndex: 60,
        pageType: "doc",
        content: doc(
          heading(1, "NG / 良い例"),
          heading(2, "NG"),
          bullet(["『なんか違う』だけで終える", "秒数や完了条件を書かない", "優先順位をつけずに大量に返す"]),
          heading(2, "良い例"),
          bullet(["秒数を指定する", "何をどう直すかを一文で書く", "提出前に見たいポイントを先に宣言する"])
        ),
      },
    ],
  },
  // ──────────────────────────────────────────────
  // 4. クライアント運用OS（旧: chatwork_ops_guide + client_ops_pack）
  // ──────────────────────────────────────────────
  {
    key: "client_ops_os",
    name: "クライアント運用OS",
    description: "クライアント別のルール・通知設計・連携運用をひとつに統合します。",
    improvementText: "クライアント知見と通知ルールがバラバラだった状態を、引き継ぎ可能な資産に変えます。",
    category: "client_ops",
    badges: ["公式", "統合パック", "1クリック導入"],
    isOfficial: true,
    sortOrder: 40,
    previewImagePath: null,
    version: "2.0.0",
    status: "active",
    integrationTargets: ["/projects", "/notifications", "/billing", "/vendors", "/payouts"],
    recommendedTemplateKeys: ["project_ops_os", "team_resource_os", "quality_os"],
    pages: [
      {
        key: "overview",
        parentPageKey: null,
        slugSeed: "client-ops-os",
        title: "クライアント運用OS",
        icon: "CL",
        orderIndex: 0,
        pageType: "doc",
        content: doc(
          heading(1, "{{install_name}}"),
          paragraph("クライアント固有ルールと通知連携の運用をひとつに統合したパックです。案件実体や納期は案件画面に残し、このパックには判断材料と連携ルールを蓄積します。"),
          heading(2, "含まれるページ"),
          bullet([
            "01_クライアント概要 — 商材・KPI・確認フロー",
            "02_NG表現・トーン&マナー — 表現ルールと言い換え集",
            "03_過去指摘集 — 指摘履歴と再発防止メモ",
            "04_素材・納品ルール — 素材置き場と納品前チェック",
            "05_通知連携設計 — ChatWork/Lark のルーム設計と方針",
            "06_通知定型文テンプレ — 毎朝・遅延・提出前の文面",
          ]),
          paragraph(linkText("案件管理を開く", "/projects")),
          paragraph(linkText("通知センターを開く", "/notifications")),
          paragraph(linkText("請求管理を開く", "/billing"))
        ),
      },
      {
        key: "client-summary",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-summary",
        title: "01_クライアント概要",
        icon: "01",
        orderIndex: 10,
        pageType: "doc",
        content: doc(
          heading(1, "クライアント概要"),
          bullet([
            "主要商材と訴求軸",
            "媒体ごとの優先 KPI",
            "意思決定者と確認フロー",
            "提出時に必ず見られるポイント",
          ])
        ),
      },
      {
        key: "ng-tone",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-ng-tone",
        title: "02_NG表現・トーン&マナー",
        icon: "02",
        orderIndex: 20,
        pageType: "snippets",
        content: doc(
          heading(1, "NG表現・トーン&マナー"),
          heading(2, "NG表現"),
          codeBlock("断定が強すぎる表現 / 誇大に見える表現 / 医療・金融などの要確認表現をここに追記"),
          codeBlock("言い換え候補: 『必ず』 -> 『目安として』, 『最短』 -> 『スムーズなら』"),
          heading(2, "トーン&マナー"),
          bullet([
            "親しみ重視 / 信頼感重視 / 上品寄りなどの軸を明文化する",
            "語尾ルールと NG の言い回しをセットで残す",
            "既存投稿で参考にする URL を下に貼る",
          ])
        ),
      },
      {
        key: "feedback-history",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-feedback-history",
        title: "03_過去指摘集",
        icon: "03",
        orderIndex: 30,
        pageType: "table_like",
        content: doc(
          heading(1, "過去指摘集"),
          codeBlock(
            "日付 | 指摘内容 | 再発防止メモ | 関連案件\n" +
              "2026-03-05 | CTA が強すぎる | 語尾をやわらかくする | 3 月 short 02\n" +
              "2026-03-12 | 尺が長い | 冒頭説明を短くする | 3 月 short 05",
            "text"
          )
        ),
      },
      {
        key: "material-delivery",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-material-delivery",
        title: "04_素材・納品ルール",
        icon: "04",
        orderIndex: 40,
        pageType: "checklist",
        content: doc(
          heading(1, "素材・納品ルール"),
          heading(2, "素材置き場ルール"),
          paragraph("案件登録時に貼る正式リンクは案件画面に残します。このページではクライアント固有のフォルダ構成や命名ルールを記録します。"),
          heading(2, "納品前チェック"),
          task([
            "最終 CTA がクライアントルールに合っている",
            "NG 表現が入っていない",
            "素材権利やクレジット表記が必要なら対応済み",
            "納品先 URL とファイル名が合っている",
          ]),
          paragraph(linkText("案件を開く", "/projects")),
          paragraph(linkText("通知センターへ", "/notifications"))
        ),
      },
      {
        key: "notification-design",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-notification-design",
        title: "05_通知連携設計",
        icon: "05",
        orderIndex: 50,
        pageType: "table_like",
        content: doc(
          heading(1, "通知連携設計"),
          paragraph("ChatWork / Lark など外部連携の運用ルールを統一します。実際の連携設定や API 疎通は本体側の責務です。"),
          heading(2, "API設定前提"),
          bullet([
            "トークンの保管場所を決める",
            "誰が発行・更新するかを owner / executive_assistant で固定する",
            "テスト送信先ルームを本番ルームと分ける",
          ]),
          heading(2, "送信ルーム設計"),
          codeBlock(
            "用途 | ルーム名 | 送る内容 | 備考\n" +
              "毎朝共有 | OPS_全体_朝会 | 今日の提出 / 遅延 | ノイズを増やしすぎない\n" +
              "遅延催促 | OPS_案件別_催促 | 期限超過連絡 | 宛先と文面を強くしすぎない",
            "text"
          ),
          heading(2, "案件別通知方針"),
          codeBlock(
            "案件タイプ | 基本通知 | 即時で出す条件 | 補足\n" +
              "短尺量産 | 毎朝まとめ + 遅延時のみ即時 | due_editor_at 当日化 / 素材不足 | 既読確認は日次で十分\n" +
              "レビュー重視案件 | 進行変化ごと | review / 差し戻し / クライアント返答 | 文章テンプレを固定する\n" +
              "外注依頼あり | 毎朝まとめ + 依頼時即時 | vendor 依頼 / 支払確認 / 回収遅延 | /vendors と併用する",
            "text"
          ),
          paragraph(linkText("通知センターを開く", "/notifications")),
          paragraph(linkText("案件管理を開く", "/projects"))
        ),
      },
      {
        key: "notification-snippets",
        parentPageKey: "overview",
        slugSeed: "client-ops-os-notification-snippets",
        title: "06_通知定型文テンプレ",
        icon: "06",
        orderIndex: 60,
        pageType: "snippets",
        content: doc(
          heading(1, "通知定型文テンプレ"),
          heading(2, "毎朝"),
          codeBlock("おはようございます。本日提出予定は 3 件です。優先度順に並べています。"),
          heading(2, "遅延催促"),
          codeBlock("提出時刻が近づいているため、現状共有をお願いします。難しければ早めに調整します。"),
          heading(2, "提出前確認"),
          codeBlock("提出前に CTA と誤字だけ最終確認をお願いします。"),
          heading(2, "一般通知"),
          codeBlock("本日提出予定の案件です。優先度の高いものから順に確認をお願いします。"),
          codeBlock("納期が近づいているため、現状の進捗だけ共有をお願いします。必要ならこちらで調整します。")
        ),
      },
    ],
  },
]
