'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const searchParams = useSearchParams()
  const reloginMessage = useMemo(() => searchParams?.get('message') === 'relogin', [searchParams])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
    })
  }, [])

  const login = async () => {
    const redirectTo = typeof window !== 'undefined' ? searchParams?.get('redirectTo') : null
    const target = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/home'
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${target}`
      }
    })
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Supabase Google Login Test</h1>

      {user ? (
        <>
          <p>ログイン成功 🎉</p>
          <p>Email: {user.email}</p>
          <button onClick={logout}>ログアウト</button>
        </>
      ) : (
        <>
          {reloginMessage && (
            <p style={{ marginBottom: 16, color: 'var(--muted)', fontSize: 14 }}>再ログインしてください。</p>
          )}
          <button onClick={login}>Googleでログイン</button>
        </>
      )}
    </div>
  )
}