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
    const uid = session?.user?.id
    if (!uid) return
    let alive = true
    setLoading(true)

    // ต้องมี catch เสมอ — ถ้าคำสั่งนี้ล้มเหลว (เน็ตหลุดจังหวะเปิดแอป) แล้วไม่จับไว้
    // setLoading(false) จะไม่ถูกเรียก ผู้ใช้จะค้างอยู่กับหน้าจอที่ยังไม่รู้สิทธิ์ตัวเอง
    // ตลอดไป (เมนูที่ต้องใช้สิทธิ์หายหมด และหน้าที่กันด้วย role จะหมุนไม่จบ)
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .maybeSingle()
        if (!alive) return
        if (error) throw error
        setProfile((data as Profile | null) ?? null)
      } catch (e) {
        if (!alive) return
        console.error('[auth] โหลดข้อมูลผู้ใช้ไม่สำเร็จ', e)
        setProfile(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
    // ผูกกับ id อย่างเดียว — ผูกกับ object session.user ด้วยจะยิงซ้ำทุกครั้งที่
    // supabase ต่ออายุ token เพราะได้ object ใหม่ทั้งที่เป็นคนเดิม
  }, [session?.user?.id])

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
