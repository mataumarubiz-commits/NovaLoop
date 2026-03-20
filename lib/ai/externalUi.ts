function compactReplyLabel(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= 20) return normalized
  return `${normalized.slice(0, 17)}...`
}

export function mapDiscordButtonPrompt(customId: string) {
  switch (customId) {
    case "nova_refresh:overall":
      return "今の全体状況を教えて"
    case "nova_refresh:contents":
      return "今の制作状況を教えて"
    case "nova_refresh:billing":
      return "今の請求状況を教えて"
    case "nova_refresh:vendor_invoices":
      return "外注請求の状況を教えて"
    case "nova_refresh:payouts":
      return "今月の支払い予定を教えて"
    case "nova_refresh:notifications":
      return "最新の通知をまとめて"
    case "nova_refresh:manuals":
      return "請求の手順を教えて"
    case "filter_approval":
      return "承認待ちだけ見せて"
    case "filter_returned":
      return "差し戻しだけ見せて"
    case "filter_delayed":
      return "遅延案件だけ見せて"
    case "filter_unsubmitted_vendor":
      return "未提出の外注請求だけ見せて"
    default:
      return null
  }
}

export function normalizeLineQuickReplyTexts(texts: readonly string[], limit = 4) {
  const unique: string[] = []
  for (const raw of texts) {
    const text = raw.trim()
    if (!text || unique.includes(text)) continue
    unique.push(text)
    if (unique.length >= limit) break
  }
  return unique
}

export function buildLineQuickReplyItems(texts: readonly string[]) {
  return normalizeLineQuickReplyTexts(texts).map((text) => ({
    type: "action" as const,
    action: {
      type: "message" as const,
      label: compactReplyLabel(text),
      text,
    },
  }))
}
