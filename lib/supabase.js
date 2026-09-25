import { createClient } from '@supabase/supabase-js';

let client;
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Setup required: add Supabase settings to .env.local and restart the app.');
  if (!client) client = createClient(url, key);
  return client;
}
