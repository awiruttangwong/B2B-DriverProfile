import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AppRole, Profile } from '../types/database'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** สิทธิ์จริงบังคับที่ฐานข้อมูลด้วย RLS — ค่านี้ใช้แค่ซ่อนปุ่มที่กดไปก็ไม่ผ่านอยู่ดี */
  can: (...roles: AppRole[]) => boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user) return
    let alive = true
    setLoading(true)

    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setProfile((data as Profile | null) ?? null)
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [session?.user?.id, session?.user])

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      can: (...roles) => (profile ? roles.includes(profile.role) : false),
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth ต้องอยู่ภายใน AuthProvider')
  return v
}
