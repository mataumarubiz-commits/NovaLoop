export type HelpCategoryId =
  | "contents"
  | "clients"
  | "billing"
  | "vendors-payouts"
  | "organization"
  | "pages"
  | "notifications"
  | "ai"

export type HelpArticleSection = {
  heading: string
  body: string[]
}

export type HelpArticle = {
  id: string
  slug: string
  href: `/help/${string}`
  title: string
  description: string
  category: HelpCategoryId
  icon: string
  order: number
  recommended_order?: number
  highlights?: string[]
  sections: HelpArticleSection[]
}

export type HelpCategory = {
  id: HelpCategoryId
  label: string
  description: string
  order: number
}

function createArticle(article: Omit<HelpArticle, "href">): HelpArticle {
  return {
    ...article,
    href: `/help/${article.slug}` as `/help/${string}`,
  }
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "contents", label: "Contents / 制作進行", description: "日々の案件進行、納期、ステータス管理", order: 1 },
  { id: "clients", label: "Clients / 案件・クライアント", description: "クライアント、案件、進行単位の持ち方", order: 2 },
  { id: "billing", label: "Billing / 請求", description: "請求対象、請求書、PDF 作成の流れ", order: 3 },
  { id: "vendors-payouts", label: "Vendors / Payouts", description: "外注請求の確認から支払いまで", order: 4 },
  { id: "organization", label: "組織 / ロール", description: "権限、メンバー、ワークスペース設定", order: 5 },
  { id: "pages", label: "Pages / ナレッジ", description: "手順書、判断基準、社内ナレッジ整備", order: 6 },
  { id: "notifications", label: "通知 / 遅延", description: "未対応、遅れ、確認漏れの追い方", order: 7 },
  { id: "ai", label: "AI活用", description: "AI の使いどころと反映の考え方", order: 8 },
]

export const HELP_ARTICLES: HelpArticle[] = [
  createArticle({
    id: "setup-workspace",
    slug: "setup-workspace",
    title: "最初にやる設定の流れ",
    description: "ワークスペース、メンバー、通知の順で、使い始める前の土台を整えます。",
    category: "organization",
    icon: "01",
    order: 1,
    recommended_order: 1,
    highlights: [
      "最初にワークスペース名と請求まわりの基本情報を揃えます。",
      "会計系の画面は owner / executive_assistant のみが使えます。",
      "通知と役割を先に整えると、運用開始後の迷いが減ります。",
    ],
    sections: [
      {
        heading: "最初に整えること",
        body: [
          "Settings では、まずワークスペース情報、メンバー、通知の順に確認します。運用に入ってから権限を直すより、最初に役割を合わせた方が手戻りが少なくなります。",
          "請求や支払いの画面を触る人がいる場合は、owner か executive_assistant にしておきます。member 相当の利用者は日次運用中心で使う前提です。",
        ],
      },
      {
        heading: "迷いやすいポイント",
        body: [
          "会計系の情報を扱う画面は全員向けではありません。Billing / Invoices / Vendors / Payouts / Vault は owner / executive_assistant のみです。",
          "Pages は運用ルールや判断基準を置く場所で、案件の正式な進行データそのものは Contents 側で管理します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "first-content",
    slug: "first-content",
    title: "最初の案件を登録するとき",
    description: "クライアント、案件名、納期、delivery_month をどう決めるかを最初に揃えます。",
    category: "contents",
    icon: "02",
    order: 1,
    recommended_order: 2,
    highlights: [
      "Contents は 1 行 = 1 つの進行単位です。",
      "請求対象月は delivery_month を基準にします。",
      "納期、担当、ステータスを毎日更新する運用が基本です。",
    ],
    sections: [
      {
        heading: "登録するときに必要な考え方",
        body: [
          "最初は client、案件名、タイトル、due_client_at、unit_price、delivery_month を揃えると運用しやすくなります。",
          "delivery_month は請求対象月です。請求したい月ではなく、納品月として扱う前提で決めます。",
        ],
      },
      {
        heading: "最初に決めておくと後で困りにくいこと",
        body: [
          "billable_flag を請求対象の行だけに付けると、Billing 側で対象を拾いやすくなります。",
          "thumbnail_done や due_editor_at を早めに持っておくと、日々の抜け漏れ確認がかなり楽になります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "pages-first-three",
    slug: "pages-first-three",
    title: "Pages で最初に作る 3 本",
    description: "請求手順、外注確認、通知対応など、最初に置いておくと効くページをまとめます。",
    category: "pages",
    icon: "03",
    order: 1,
    recommended_order: 3,
    highlights: [
      "Pages は手順書と判断基準を置くための場所です。",
      "Contents や Billing の正式データを二重管理しないのが前提です。",
      "毎日見る導線より、迷ったときに戻る基準を作るのが役割です。",
    ],
    sections: [
      {
        heading: "最初の 3 本に向いている内容",
        body: [
          "最初は『請求手順』『外注請求の確認フロー』『通知対応ルール』の 3 本を作ると、日常運用の迷いが減ります。",
          "運用ルールや例外時の判断は Pages に残し、案件の状態や納期は Contents に残す使い分けにします。",
        ],
      },
      {
        heading: "Pages の使い方で外さないこと",
        body: [
          "Pages はナレッジの置き場であって、正式な案件台帳ではありません。仕事の真実は Contents、請求の真実は Billing / Invoices に置きます。",
          "更新頻度が高いルールは短いページに分けた方が、あとから探しやすくなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "contents-daily",
    slug: "contents-daily",
    title: "Contents の日次運用",
    description: "毎日どこを見て、何を更新すると進行が崩れにくいかをまとめます。",
    category: "contents",
    icon: "C",
    order: 2,
    highlights: [
      "今日の納期、遅れ、未提出を優先して見ます。",
      "ステータスを止めたままにせず、小さく更新します。",
      "納期変更が入ったら delivery_month への影響も確認します。",
    ],
    sections: [
      {
        heading: "毎日確認する順番",
        body: [
          "最初に今日の納期、次に遅れ、最後に未提出を見ます。Home や Notifications で気になる行を見つけたら、最終的な更新は Contents で行います。",
          "status、due_client_at、due_editor_at、担当、nextAction など、進行に直結する項目を止めずに更新することが大事です。",
        ],
      },
      {
        heading: "止まりやすい場面",
        body: [
          "納期だけ変えて delivery_month を見直していないと、請求側とのズレが起きます。請求対象かどうかは billable_flag とあわせて確認します。",
          "Pages にだけ運用メモを書いて Contents を更新しないと、現場の状況が追えなくなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "clients-projects",
    slug: "clients-projects",
    title: "クライアントと案件の持ち方",
    description: "クライアント単位と案件単位をどう分けるか、迷いにくい運用基準をまとめます。",
    category: "clients",
    icon: "CL",
    order: 1,
    highlights: [
      "クライアントは請求先や関係先の単位です。",
      "案件は進行や担当を分けたい単位で持ちます。",
      "同じ取引先でも運用ラインが違うなら案件を分けた方が見やすくなります。",
    ],
    sections: [
      {
        heading: "分け方の目安",
        body: [
          "請求先や契約先として同じでも、進行の担当や納期の持ち方が違うなら案件を分けます。",
          "クライアントは相手先の単位、案件は自分たちが追いかける仕事の単位と考えると整理しやすくなります。",
        ],
      },
      {
        heading: "迷ったときの決め方",
        body: [
          "請求書を分けたい、担当を分けたい、納期の山を分けたい、のどれかがあるなら案件を分けるのが安全です。",
          "Pages は案件ごとの補足ルール置き場に向いていますが、日々の進行状況そのものは Contents や Projects に残します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "billing-monthly",
    slug: "billing-monthly",
    title: "月次請求の流れ",
    description: "Billing での集計から Invoice PDF 作成までの前提と確認ポイントを整理します。",
    category: "billing",
    icon: "B",
    order: 1,
    highlights: [
      "請求対象月は delivery_month を基準にします。",
      "消費税欄はなく、税区分は免税前提です。",
      "PDF は作成までで、自動メール送信はしません。",
    ],
    sections: [
      {
        heading: "Billing で確認すること",
        body: [
          "Billing では、delivery_month が対象月で、ステータスや billable_flag が請求条件に合っている行をまとめて確認します。",
          "請求対象月は納品月基準です。締め月を別で持たず、delivery_month をそのまま請求月として扱います。",
        ],
      },
      {
        heading: "PDF と運用ルール",
        body: [
          "請求書 PDF のファイル名は【御請求書】YYYY-MM_請求先名_請求名.pdf の形式です。",
          "送信は自動では行いません。NovaLoop では PDF を生成するところまでを扱い、メール送付や手渡しは運用側で行います。",
        ],
      },
      {
        heading: "権限まわり",
        body: [
          "Billing / Invoices / Vault は owner / executive_assistant のみが扱えます。member は請求の正式画面には入りません。",
          "税は免税前提なので、消費税入力欄はありません。金額調整は明細や請求名側で整理します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "vendors-payouts",
    slug: "vendors-payouts",
    title: "外注請求と支払いの流れ",
    description: "Vendors での確認から Payouts での支払い管理までを一続きで整理します。",
    category: "vendors-payouts",
    icon: "V",
    order: 1,
    highlights: [
      "外注請求は Vendors で確認し、支払いは Payouts で管理します。",
      "提出、確認、承認、支払い準備の段階を分けると詰まりが見えやすくなります。",
      "会計系の操作は owner / executive_assistant 向けです。",
    ],
    sections: [
      {
        heading: "外注請求の確認",
        body: [
          "Vendors では、提出された請求の内容を確認し、差し戻しや承認の判断を行います。",
          "請求内容に不明点がある場合は、そのまま支払い準備へ進めず、確認待ちの状態を明確に残します。",
        ],
      },
      {
        heading: "支払い準備と実行",
        body: [
          "承認後は Payouts で支払い予定日、金額、CSV 出力の準備をまとめます。",
          "支払い済みの更新は Payouts 側で行い、どこまで完了したかを一か所で追えるようにします。",
        ],
      },
    ],
  }),
  createArticle({
    id: "organization-roles",
    slug: "organization-roles",
    title: "owner・executive_assistant・member の違い",
    description: "誰がどこまで使えるかを、運用と会計の境界が分かる形で整理します。",
    category: "organization",
    icon: "R",
    order: 2,
    highlights: [
      "owner はワークスペース全体と会計まわりを管理します。",
      "executive_assistant は owner に近い運用補佐役です。",
      "member は日次運用中心で、会計系の正式画面には入りません。",
    ],
    sections: [
      {
        heading: "役割のざっくりした見方",
        body: [
          "owner はワークスペース全体の責任者で、会計や権限設定も含めて管理します。",
          "executive_assistant は運用補佐として owner に近い範囲を扱えます。会計系の実務に入る人はこの権限です。",
          "member は日々の進行、確認、更新が中心です。請求・支払い・Vault などの会計系画面は対象外です。",
        ],
      },
      {
        heading: "よくある混乱",
        body: [
          "『見えているけれど更新してよいのか』で迷うときは、会計情報か、日次進行情報か、で切り分けると判断しやすくなります。",
          "PM、director、worker など内部の役割差があっても、運用上の大きな境界は owner / executive_assistant と member で考えると分かりやすいです。",
        ],
      },
    ],
  }),
  createArticle({
    id: "pages-knowledge",
    slug: "pages-knowledge",
    title: "Pages をナレッジ置き場として使う",
    description: "Pages に何を書くと運用が軽くなり、何を書かない方がよいかを整理します。",
    category: "pages",
    icon: "P",
    order: 2,
    highlights: [
      "Pages はルール、手順、判断基準を置く場所です。",
      "案件の現在地や請求の正式データは別画面がソースです。",
      "短いページに分けると、あとから探しやすくなります。",
    ],
    sections: [
      {
        heading: "Pages に向いているもの",
        body: [
          "クライアント別の注意点、レビュー観点、月末の締め手順、通知対応ルールなどは Pages に向いています。",
          "『迷ったらここを見る』という判断基準を置くと、担当が変わっても運用がぶれにくくなります。",
        ],
      },
      {
        heading: "Pages に置かない方がよいもの",
        body: [
          "日々変わる納期、担当、請求状態などの正式データを Pages に持つと二重管理になります。正式な更新は Contents や Billing 側で行います。",
          "Pages には背景や判断理由を残し、数値や進行状態は本体画面に寄せるのが安全です。",
        ],
      },
    ],
  }),
  createArticle({
    id: "notifications-delays",
    slug: "notifications-delays",
    title: "通知と遅れを追うとき",
    description: "未対応通知、遅延、確認待ちをどの順で見ていくかを短く整理します。",
    category: "notifications",
    icon: "N",
    order: 1,
    highlights: [
      "通知は入り口で、最終確認は対象画面で行います。",
      "遅れ、未確認、支払い待ちなど、優先度の高いものから処理します。",
      "通知を見ただけで終えず、Contents や Payouts で状態を更新します。",
    ],
    sections: [
      {
        heading: "通知の基本的な見方",
        body: [
          "Notifications では、何が止まっているかを一覧で把握し、対応先の画面へ移動します。",
          "通知はあくまで入り口です。実際の更新は Contents、Vendors、Payouts など対象の画面で行います。",
        ],
      },
      {
        heading: "遅れに気づいたとき",
        body: [
          "納期遅れなら Contents、外注確認待ちなら Vendors、支払い待ちなら Payouts というように、どこで正式に直すかを分けて考えます。",
          "遅れの理由や再発防止のルールは Pages に残すと、次回以降の判断が早くなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "ai-usage",
    slug: "ai-usage",
    title: "AI を使うときの考え方",
    description: "AI をどこで使い、どこまでを人が確定させる前提かを整理します。",
    category: "ai",
    icon: "AI",
    order: 1,
    highlights: [
      "AI は下書きや整理の補助で使い、最終確定は人が行います。",
      "Contents ではローカルな下書きとして扱う導線が中心です。",
      "Pages や外部連携 AI は、判断材料をそろえる用途に向いています。",
    ],
    sections: [
      {
        heading: "AI の使いどころ",
        body: [
          "AI は文章のたたき台、要約、整理に向いています。判断や承認そのものを自動で置き換える前提ではありません。",
          "Pages では手順書や文面の整形に、Contents では下書きの作成に使うと実務に馴染みやすくなります。",
        ],
      },
      {
        heading: "運用で外さないこと",
        body: [
          "AI の出力はそのまま確定せず、内容を見てから適用します。請求、支払い、正式な納期変更などの確定は人が行います。",
          "Discord / LINE などの連携 AI は状況確認の補助で、権限に応じた read-only 運用が中心です。",
        ],
      },
    ],
  }),
]

export function getCategoryLabel(categoryId: HelpCategoryId): string {
  return HELP_CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId
}

export type HelpSearchResult = {
  article: HelpArticle
  score: number
  excerpt: string
  steps: string[]
}

function normalizeHelpQuery(value: string) {
  return value.toLowerCase().replace(/\s+/g, "")
}

function articleSearchText(article: HelpArticle) {
  return normalizeHelpQuery(
    [
      article.title,
      article.description,
      getCategoryLabel(article.category),
      ...(article.highlights ?? []),
      ...article.sections.flatMap((section) => [section.heading, ...section.body]),
    ].join(" ")
  )
}

function articleSteps(article: HelpArticle) {
  return article.sections.flatMap((section) => section.body).filter(Boolean).slice(0, 6)
}

function articleExcerpt(article: HelpArticle) {
  return article.sections.flatMap((section) => section.body).find(Boolean) ?? article.description
}

export function searchHelpArticles(query: string, limit = 5): HelpSearchResult[] {
  const normalizedQuery = normalizeHelpQuery(query)

  const results = HELP_ARTICLES.map((article) => {
    const searchText = articleSearchText(article)
    let score = 0

    if (!normalizedQuery) {
      score = article.recommended_order ? 100 - article.recommended_order : 10
    } else {
      if (normalizeHelpQuery(article.title).includes(normalizedQuery)) score += 8
      if (normalizeHelpQuery(article.description).includes(normalizedQuery)) score += 4
      if (normalizeHelpQuery(getCategoryLabel(article.category)).includes(normalizedQuery)) score += 2
      if (searchText.includes(normalizedQuery)) score += 1

      for (const token of normalizedQuery.split(/[\/,]/).filter(Boolean)) {
        if (searchText.includes(token)) score += 1
      }
    }

    return {
      article,
      score,
      excerpt: articleExcerpt(article),
      steps: articleSteps(article),
    }
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if ((a.article.recommended_order ?? 999) !== (b.article.recommended_order ?? 999)) {
        return (a.article.recommended_order ?? 999) - (b.article.recommended_order ?? 999)
      }
      if (a.article.order !== b.article.order) return a.article.order - b.article.order
      return a.article.title.localeCompare(b.article.title, "ja")
    })

  return results.slice(0, limit)
}

export function getHelpAnswerCandidates(query: string, limit = 5) {
  return searchHelpArticles(query, limit).map(({ article, excerpt, steps }) => ({
    id: article.id,
    slug: article.slug,
    href: article.href,
    title: article.title,
    description: article.description,
    category: article.category,
    category_label: getCategoryLabel(article.category),
    excerpt,
    steps,
  }))
}
