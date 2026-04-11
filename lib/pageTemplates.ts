export type PageTemplateKey =
  | "blank"
  | "business_manual"
  | "client_ops"
  | "billing_procedure"
  | "payout_procedure"
  | "meeting_notes"
  | "checklist"

export type PageTemplate = {
  title: string
  description: string
  badge: string
  content: Record<string, unknown>
}

function heading(level: 1 | 2, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] }
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] }
}

function bullet(items: string[]) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
    })),
  }
}

function ordered(items: string[]) {
  return {
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
    })),
  }
}

function task(items: string[]) {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
    })),
  }
}

export const PAGE_TEMPLATES: Record<Exclude<PageTemplateKey, "blank">, PageTemplate> = {
  business_manual: {
    title: "業務手順書",
    description: "新しく入った人でも迷わず進められる業務手順を残すテンプレです。",
    badge: "Manual",
    content: {
      type: "doc",
      content: [
        heading(1, "業務手順書"),
        paragraph("この手順書は、担当者が変わっても同じ品質で進行できる状態を目指して作成します。"),
        heading(2, "目的"),
        bullet(["この手順で何を実現するか", "どの業務に使うか"]),
        heading(2, "対象"),
        paragraph("誰がこの手順を使うのかを明記します。"),
        heading(2, "事前準備"),
        bullet(["必要な権限", "必要なURL", "必要なファイルや素材"]),
        heading(2, "手順"),
        ordered(["手順1", "手順2", "手順3"]),
        heading(2, "注意点"),
        bullet(["ミスしやすい点", "例外時の判断基準"]),
      ],
    },
  },
  client_ops: {
    title: "運用ルール",
    description: "クライアント別の運用ルールや判断基準を残すテンプレです。",
    badge: "Rule",
    content: {
      type: "doc",
      content: [
        heading(1, "運用ルール"),
        paragraph("チーム内で判断を揃えるための基準をまとめます。"),
        heading(2, "基本方針"),
        bullet(["優先する指標", "更新頻度", "判断の基準"]),
        heading(2, "例外対応"),
        bullet(["例外ケース", "誰に確認するか", "エスカレーション条件"]),
        heading(2, "共有ルール"),
        paragraph("Slack、Pages、Notifications でどこまで共有するかを決めます。"),
      ],
    },
  },
  billing_procedure: {
    title: "請求手順",
    description: "Billing から Invoices、PDF確認までの月次請求フローを残すテンプレです。",
    badge: "Billing",
    content: {
      type: "doc",
      content: [
        heading(1, "請求手順"),
        paragraph("月次請求を安全に進めるための確認順を残します。"),
        heading(2, "事前確認"),
        bullet(["対象月を確認する", "請求対象の案件明細を確認する", "重複請求がないかを見る"]),
        heading(2, "Billing の操作"),
        ordered(["対象月を選ぶ", "プレビューを確認する", "請求書を生成する"]),
        heading(2, "Invoices の確認"),
        bullet(["請求番号", "PDF生成", "コピー新規の使い方"]),
      ],
    },
  },
  payout_procedure: {
    title: "外注支払い手順",
    description: "外注請求の承認、CSV出力、支払済み更新までのテンプレです。",
    badge: "Payout",
    content: {
      type: "doc",
      content: [
        heading(1, "外注支払い手順"),
        paragraph("Vendors と Payouts を使った月末支払いの流れを残します。"),
        heading(2, "確認事項"),
        bullet(["submitted / approved の確認", "差し戻し理由の有無", "振込先の最新性"]),
        heading(2, "支払い処理"),
        ordered(["承認する", "Payouts に載せる", "CSV を出力する", "支払済みに更新する"]),
        heading(2, "注意点"),
        bullet(["差し戻し時は同一請求IDで再提出", "PDF は submitted 時点のものを使う"]),
      ],
    },
  },
  meeting_notes: {
    title: "会議メモ",
    description: "会議内容、決定事項、次アクションを残すテンプレです。",
    badge: "Note",
    content: {
      type: "doc",
      content: [
        heading(1, "会議メモ"),
        paragraph("会議の記録と次のアクションを残します。"),
        heading(2, "参加者"),
        bullet(["参加者名"]),
        heading(2, "決定事項"),
        bullet(["決定事項を記載"]),
        heading(2, "次アクション"),
        task(["アクション1", "アクション2"]),
      ],
    },
  },
  checklist: {
    title: "チェックリスト",
    description: "公開前、請求前、納品前などの確認事項を残すテンプレです。",
    badge: "Check",
    content: {
      type: "doc",
      content: [
        heading(1, "チェックリスト"),
        paragraph("定型の確認事項を毎回同じ順番で見られるようにします。"),
        task(["確認項目 1", "確認項目 2", "確認項目 3"]),
      ],
    },
  },
}

export const PAGE_TEMPLATE_KEYS = Object.keys(PAGE_TEMPLATES) as (keyof typeof PAGE_TEMPLATES)[]
