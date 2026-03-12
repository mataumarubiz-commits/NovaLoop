"use client"

import Modal from "./Modal"

type ConfirmModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  variant?: "danger" | "primary"
  loading?: boolean
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel = "キャンセル",
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  const isDanger = variant === "danger"
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 20, lineHeight: 1.5 }}>{body}</p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          style={{
            padding: "10px 18px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          style={{
            padding: "10px 18px",
            borderRadius: 12,
            border: `1px solid var(${isDanger ? "--button-danger-border" : "--button-primary-bg"})`,
            background: `var(${isDanger ? "--button-danger-bg" : "--button-primary-bg"})`,
            color: `var(${isDanger ? "--button-danger-text" : "--button-primary-text"})`,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "実行中…" : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
