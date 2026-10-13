import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

function projectUrl(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '')
}

const url = projectUrl(import.meta.env.VITE_SUPABASE_URL)
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabaseAnonKey = anonKey
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export const authConfigured = supabase !== null
