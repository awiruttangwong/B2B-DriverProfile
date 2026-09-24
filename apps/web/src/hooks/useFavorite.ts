import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * ปักหมุด/เอาออกจากรายการ "พขร. ประจำของฉัน" — private ต่อ user (driver_favorites,
 * 0034_driver_favorites.sql) ใช้ซ้ำทั้งปุ่มที่หน้าโปรไฟล์และแต่ละแถวในหน้ารายการ
 * จึงแยกเป็น hook กลางไว้ที่นี่ (ต่างจาก 3 hook นับ badge เดิมที่ใช้จุดเดียวจึงประกาศ
 * อยู่ใน App.tsx ได้เลย)
 */
export function useFavorite(driverId: string, knownFavorite?: boolean) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const uid = session?.user.id
  // ผู้เรียกที่รู้คำตอบอยู่แล้วส่งมาได้เลย — หน้า "พขร. ประจำของฉัน" ทุกแถวคือคนที่ปักหมุดไว้
  // อยู่แล้วโดยนิยาม ถ้าปล่อยให้แต่ละแถวยิง query ถามซ้ำว่า "ปักหมุดไว้ไหม" จะกลายเป็น N+1
  // (เปิดหน้าที่มี 20 คน = ยิงเพิ่มอีก 20 ครั้งเพื่อถามสิ่งที่รู้คำตอบแน่นอนอยู่แล้ว)
  const skipQuery = knownFavorite !== undefined

  const q = useQuery({
    queryKey: ['driver', driverId, 'favorite'],
    enabled: !!uid && !skipQuery,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_favorites')
        .select('driver_id')
        .eq('driver_id', driverId)
        .maybeSingle()
      if (error) throw error
      return !!data
    },
  })

  const isFavorite = skipQuery ? knownFavorite : !!q.data

  const toggle = useMutation({
    mutationFn: async () => {
      if (isFavorite) {
        const { error } = await supabase.from('driver_favorites').delete().eq('driver_id', driverId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('driver_favorites').insert({ driver_id: driverId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', driverId, 'favorite'] })
      qc.invalidateQueries({ queryKey: ['favorites'] })
      qc.invalidateQueries({ queryKey: ['favorite-count'] })
    },
  })

  // เดิมไม่มี onError เลย — ถ้า insert/delete พังกลางทาง (เช่น ชนกันเองจากคนละแท็บ/
  // อุปกรณ์พร้อมกันพอดี ก็ยังพังได้แม้ปุ่มถูก disabled กันดับเบิลคลิกในแท็บเดียวกันแล้ว)
  // ปุ่มจะดูเหมือนกดไม่ติดเฉย ๆ โดยไม่บอกอะไรเลย จึงเก็บข้อความ error ไว้ให้ผู้เรียกใช้
  // แสดงต่อได้ (ไม่ auto-clear เอง — เคลียร์ตอนกดปุ่มใหม่อีกครั้งพอ)
  const errorMessage = toggle.isError
    ? toggle.error instanceof Error && toggle.error.message.includes('row-level security')
      ? 'ไม่มีสิทธิ์ทำรายการนี้ — ลองโหลดหน้าใหม่'
      : 'ทำรายการไม่สำเร็จ ลองอีกครั้ง'
    : null

  return {
    isFavorite,
    isLoading: q.isLoading,
    isToggling: toggle.isPending,
    error: errorMessage,
    toggle: () => toggle.mutate(),
  }
}
