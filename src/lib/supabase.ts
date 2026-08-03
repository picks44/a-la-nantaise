import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Configuration Supabase manquante. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.',
    )
  }

  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }

  return client
}
