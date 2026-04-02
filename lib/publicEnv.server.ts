import fs from "node:fs"
import path from "node:path"

type RuntimePublicEnv = {
  appUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
}

function parseDotEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return new Map<string, string>()
  }

  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  const values = new Map<string, string>()

  for (const row of rows) {
    const trimmed = row.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values.set(key, value)
  }

  return values
}

function getPublicEnvValue(name: "NEXT_PUBLIC_APP_URL" | "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const processValue = process.env[name]?.trim()
  if (processValue) {
    return processValue
  }

  const fileValues = parseDotEnvFile(path.join(process.cwd(), ".env.local"))
  return fileValues.get(name)?.trim() ?? ""
}

export function getRuntimePublicEnv(): RuntimePublicEnv {
  return {
    appUrl: getPublicEnvValue("NEXT_PUBLIC_APP_URL"),
    supabaseUrl: getPublicEnvValue("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: getPublicEnvValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  }
}
