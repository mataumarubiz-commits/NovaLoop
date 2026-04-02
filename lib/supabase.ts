import { createClient, type SupabaseClient } from "@supabase/supabase-js"

type BrowserRuntimePublicEnv = {
  appUrl?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
}

const MISSING_PUBLIC_SUPABASE_MESSAGE =
  "Supabase public settings are missing. " +
  "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local or your deployment environment."

let hasLoggedMissingPublicSupabase = false
let hasInstalledSupabaseAuthConsoleFilter = false

function getBrowserRuntimePublicEnv(): BrowserRuntimePublicEnv | null {
  if (typeof window === "undefined") {
    return null
  }

  const runtimeEnv = (window as typeof window & {
    __NOVALOOP_PUBLIC_ENV__?: BrowserRuntimePublicEnv
  }).__NOVALOOP_PUBLIC_ENV__

  return runtimeEnv ?? null
}

function createMissingPublicSupabaseError() {
  if (!hasLoggedMissingPublicSupabase) {
    console.error(MISSING_PUBLIC_SUPABASE_MESSAGE)
    hasLoggedMissingPublicSupabase = true
  }

  return new Error(MISSING_PUBLIC_SUPABASE_MESSAGE)
}

function hasInvalidRefreshTokenText(value: string) {
  return /invalid refresh token|refresh token not found/i.test(value)
}

function isInvalidRefreshTokenError(value: unknown): boolean {
  if (typeof value === "string") {
    return hasInvalidRefreshTokenText(value)
  }

  if (value instanceof Error) {
    return hasInvalidRefreshTokenText(value.message) || hasInvalidRefreshTokenText(value.name)
  }

  if (typeof value === "object" && value !== null) {
    const maybeMessage = "message" in value && typeof value.message === "string" ? value.message : null
    const maybeName = "name" in value && typeof value.name === "string" ? value.name : null
    return Boolean(
      (maybeMessage && hasInvalidRefreshTokenText(maybeMessage)) ||
        (maybeName && hasInvalidRefreshTokenText(maybeName))
    )
  }

  return false
}

function installSupabaseAuthConsoleFilter() {
  if (hasInstalledSupabaseAuthConsoleFilter || typeof window === "undefined") {
    return
  }

  const originalConsoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => isInvalidRefreshTokenError(arg))) {
      return
    }
    originalConsoleError(...args)
  }

  hasInstalledSupabaseAuthConsoleFilter = true
}

function resolvePublicSupabaseConfig() {
  const runtimeEnv = getBrowserRuntimePublicEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || runtimeEnv?.supabaseUrl?.trim() || ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || runtimeEnv?.supabaseAnonKey?.trim() || ""

  return { url, anonKey }
}

function createMissingQueryBuilder() {
  const result = () => ({
    data: null,
    error: createMissingPublicSupabaseError(),
    count: null,
    status: 0,
    statusText: "Supabase public settings missing",
  })

  const target = {
    then(onfulfilled?: (value: ReturnType<typeof result>) => unknown, onrejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result()).then(onfulfilled, onrejected)
    },
    catch(onrejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result()).catch(onrejected)
    },
    finally(onfinally?: (() => void) | undefined) {
      return Promise.resolve(result()).finally(onfinally)
    },
  }

  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (prop in currentTarget) {
        return Reflect.get(currentTarget, prop, receiver)
      }
      return () => receiver
    },
  })
}

function createMissingSupabaseClient() {
  const queryBuilder = () => createMissingQueryBuilder()

  return {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: createMissingPublicSupabaseError(),
        }
      },
      async getSession() {
        return {
          data: { session: null },
          error: createMissingPublicSupabaseError(),
        }
      },
      async refreshSession() {
        return {
          data: { session: null, user: null },
          error: createMissingPublicSupabaseError(),
        }
      },
      async signInWithOAuth() {
        return {
          data: { provider: "google", url: null },
          error: createMissingPublicSupabaseError(),
        }
      },
      async signOut() {
        return {
          error: createMissingPublicSupabaseError(),
        }
      },
      async updateUser() {
        return {
          data: { user: null },
          error: createMissingPublicSupabaseError(),
        }
      },
      onAuthStateChange() {
        return {
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        }
      },
    },
    from() {
      return queryBuilder()
    },
    rpc() {
      return queryBuilder()
    },
    storage: {
      from() {
        return queryBuilder()
      },
    },
  } as unknown as SupabaseClient
}

const { url: supabaseUrl, anonKey: supabaseAnonKey } = resolvePublicSupabaseConfig()

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? (installSupabaseAuthConsoleFilter(), createClient(supabaseUrl, supabaseAnonKey))
    : createMissingSupabaseClient()
