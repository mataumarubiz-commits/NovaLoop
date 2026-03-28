"use client"

import { useEffect } from "react"

export default function Modal({
  title,
  children,
  onClose,
  open,
}: {
  title?: string
  children: React.ReactNode
  onClose: () => void
  open: boolean
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 50,
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "90%",
          maxWidth: 400,
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow-xl)",
          zIndex: 51,
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2
            id="modal-title"
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text)",
              margin: "0 0 16px 0",
            }}
          >
            {title}
          </h2>
        )}
        {children}
      </div>
    </>
  )
}
