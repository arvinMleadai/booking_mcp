import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import 'server-only'

// Create a Supabase client for server-side use (Express environment)
export const createClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not set in environment variables');
  }

  // Prefer service role key for server-side operations as it bypasses RLS
  const keyToUse = serviceRoleKey || anonKey;
  
  if (!keyToUse) {
    throw new Error('Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is set in environment variables');
  }

  if (!serviceRoleKey) {
    console.warn('Using anon key - RLS policies will be enforced. Consider setting SUPABASE_SERVICE_ROLE_KEY for server operations.');
  }

  return createSupabaseClient(supabaseUrl, keyToUse, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};
