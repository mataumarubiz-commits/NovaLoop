import crypto from "node:crypto"

function discordPublicKeyToKeyObject(hexKey: string) {
  const keyBytes = Buffer.from(hexKey, "hex")
  const prefix = Buffer.from("302a300506032b6570032100", "hex")
  const der = Buffer.concat([prefix, keyBytes])
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" })
}

export function verifyDiscordInteractionSignature(params: {
  body: string
  signature: string | null
  timestamp: string | null
  publicKey?: string
  maxAgeSeconds?: number
}) {
  const { body, signature, timestamp, publicKey, maxAgeSeconds = 300 } = params
  if (!body || !signature || !timestamp || !publicKey) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds)
  if (ageSeconds > maxAgeSeconds) return false

  try {
    const key = discordPublicKeyToKeyObject(publicKey)
    const message = Buffer.from(`${timestamp}${body}`, "utf8")
    const signatureBytes = Buffer.from(signature, "hex")
    return crypto.verify(null, message, key, signatureBytes)
  } catch {
    return false
  }
}
