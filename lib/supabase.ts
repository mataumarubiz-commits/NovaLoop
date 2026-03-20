import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const MISSING_PUBLIC_SUPABASE_MESSAGE =
  "Supabase public settings are missing. " +
  "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local or your deployment environment."

let hasLoggedMissingPublicSupabase = false

function createMissingPublicSupabaseError() {
  if (!hasLoggedMissingPublicSupabase) {
    console.error(MISSING_PUBLIC_SUPABASE_MESSAGE)
    hasLoggedMissingPublicSupabase = true
  }

  return new Error(MISSING_PUBLIC_SUPABASE_MESSAGE)
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : createMissingSupabaseClient()
