"use client"

import { useState, useCallback, type CSSProperties } from "react"
import { supabase } from "@/lib/supabase"

type Props = {
  orgId: string
  vendorId: string
  vendorName: string
  onClose: () => void
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function formatMonth(m: string) {
  const [y, mo] = m.split("-")
  return `${y}年${parseInt(mo, 10)}月`
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 16,
}

const dialogStyle: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  padding: 24,
  width: "100%",
  maxWidth: 480,
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "var(--shadow-xl)",
  position: "relative",
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 6,
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--input-bg)",
  color: "var(--text)",
  boxSizing: "border-box",
}

const fieldGap: CSSProperties = { marginBottom: 14 }

export default function VendorSubmitLinkDialog({
  orgId,
  vendorId,
  vendorName,
  onClose,
}: Props) {
  const [targetMonth, setTargetMonth] = useState(currentMonth())
  const [expiresIn, setExpiresIn] = useState<"none" | "7d" | "14d" | "30d">("14d")
  const [allowResubmission, setAllowResubmission] = useState(false)
  const [customMessage, setCustomMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    url: string
    isExisting: boolean
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [msgCopied, setMsgCopied] = useState(false)

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("認証エラー")
        return
      }

      let expiresAt: string | null = null
      if (expiresIn !== "none") {
        const days = expiresIn === "7d" ? 7 : expiresIn === "14d" ? 14 : 30
        const d = new Date()
        d.setDate(d.getDate() + days)
        d.setHours(23, 59, 59, 999)
        expiresAt = d.toISOString()
      }

      const res = await fetch("/api/vendor-submit/issue-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId,
          vendorId,
          targetMonth,
          expiresAt,
          allowResubmission,
          customMessage: customMessage.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "発行に失敗しました")
      } else {
        setResult({ url: data.url, isExisting: data.isExisting })
      }
    } catch {
      setError("通信エラーが発生しました")
    } finally {
      setLoading(false)
    }
  }, [orgId, vendorId, targetMonth, expiresIn, allowResubmission, customMessage])

  const copyUrl = useCallback(() => {
    if (!result) return
    navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [result])

  const copyMessage = useCallback(() => {
    if (!result) return
    const msg = `${vendorName}様\n\n${formatMonth(targetMonth)}分のご請求はこちらからお願いいたします。\n5分ほどで完了します。\n\n${result.url}\n\nご不明点がございましたらお気軽にご連絡ください。`
    navigator.clipboard.writeText(msg)
    setMsgCopied(true)
    setTimeout(() => setMsgCopied(false), 2000)
  }, [result, vendorName, targetMonth])

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "none",
            border: "none",
            fontSize: 20,
            color: "var(--muted)",
            cursor: "pointer",
            padding: 4,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
          請求提出URLを発行
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
          {vendorName} 様向け
        </div>

        {!result ? (
          <>
            {/* Target month */}
            <div style={fieldGap}>
              <label style={labelStyle}>対象月</label>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Expiry */}
            <div style={fieldGap}>
              <label style={labelStyle}>有効期限</label>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value as typeof expiresIn)}
                style={inputStyle}
              >
                <option value="7d">7日間</option>
                <option value="14d">14日間</option>
                <option value="30d">30日間</option>
                <option value="none">期限なし</option>
              </select>
            </div>

            {/* Allow resubmission */}
            <div style={{ ...fieldGap, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                id="allow-resub"
                checked={allowResubmission}
                onChange={(e) => setAllowResubmission(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <label
                htmlFor="allow-resub"
                style={{ fontSize: 13, color: "var(--text)", cursor: "pointer" }}
              >
                再提出を許可する
              </label>
            </div>

            {/* Custom message */}
            <div style={fieldGap}>
              <label style={labelStyle}>メッセージ（任意）</label>
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="外注先へのメッセージがあれば入力してください"
                style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
              />
            </div>

            {error && (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#dc2626",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px 20px",
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                background: "#6366f1",
                border: "none",
                borderRadius: 10,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "発行中…" : "URLを発行する"}
            </button>
          </>
        ) : (
          <>
            {/* Result */}
            {result.isExisting && (
              <div
                style={{
                  background: "#fffbeb",
                  color: "#d97706",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                この月のURLは既に発行済みです。既存のURLを表示しています。
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>提出URL</label>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  readOnly
                  value={result.url}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    fontSize: 12,
                    background: "#f8fafc",
                    color: "var(--text)",
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={copyUrl}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: copied ? "#ecfdf5" : "var(--surface)",
                    color: copied ? "#16a34a" : "var(--text)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                  }}
                >
                  {copied ? "コピー済み" : "コピー"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>送付メッセージテンプレート</label>
              <div
                style={{
                  background: "#f8fafc",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                  border: "1px solid var(--border)",
                }}
              >
                {`${vendorName}様\n\n${formatMonth(targetMonth)}分のご請求はこちらからお願いいたします。\n5分ほどで完了します。\n\n${result.url}\n\nご不明点がございましたらお気軽にご連絡ください。`}
              </div>
              <button
                onClick={copyMessage}
                style={{
                  marginTop: 8,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: msgCopied ? "#ecfdf5" : "var(--surface)",
                  color: msgCopied ? "#16a34a" : "var(--text)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {msgCopied ? "メッセージをコピー済み" : "メッセージごとコピー"}
              </button>
            </div>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--surface)",
                color: "var(--text)",
                cursor: "pointer",
                marginTop: 4,
              }}
            >
              閉じる
            </button>
          </>
        )}
      </div>
    </div>
  )
}
