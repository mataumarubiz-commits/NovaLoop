import crypto from "node:crypto"

export function maskExternalId(value: string | null | undefined) {
  if (!value) return null
  if (value.length <= 6) return value
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}

export function verifyLineSignature(body: string, signature: string | null, secret: string | undefined) {
  if (!signature || !secret) return false
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64")
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

function discordPublicKeyToPem(hexKey: string) {
  const keyBytes = Buffer.from(hexKey, "hex")
  const prefix = Buffer.from("302a300506032b6570032100", "hex")
  const der = Buffer.concat([prefix, keyBytes])
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" })
}

export function verifyDiscordSignature(params: {
  body: string
  signature: string | null
  timestamp: string | null
  publicKey: string | undefined
}) {
  if (!params.signature || !params.timestamp || !params.publicKey) return false
  const key = discordPublicKeyToPem(params.publicKey)
  const message = Buffer.from(`${params.timestamp}${params.body}`, "utf8")
  const sig = Buffer.from(params.signature, "hex")
  return crypto.verify(null, message, key, sig)
}
