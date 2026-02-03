import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Create a Supabase client for server-side use (Express environment)
export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // console.log('🔧 Supabase Client Debug:');
  // console.log('URL:', supabaseUrl ? 'Set' : 'Missing');
  // console.log('Service Role Key:', serviceRoleKey ? `Set (will bypass RLS) - ${serviceRoleKey.substring(0, 20)}...` : 'Missing');
  // console.log('Anon Key:', anonKey ? `Set (requires RLS policies) - ${anonKey.substring(0, 20)}...` : 'Missing');
  // console.log('Using Key Type:', serviceRoleKey ? 'SERVICE_ROLE' : 'ANON');

  if (!supabaseUrl) {
    throw new Error('DEVELOP_PUBLIC_SUPABASE_URL is not set in environment variables');
  }

  // Prefer service role key for server-side operations as it bypasses RLS
  const keyToUse = serviceRoleKey || anonKey;
  
  if (!keyToUse) {
    throw new Error('Neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY is set in environment variables');
  }

  if (!serviceRoleKey) {
    console.warn('Using anon key - RLS policies will be enforced. Consider using NEXT_SUPABASE_SERVICE_ROLE_KEY for server operations.');
  }

  return createSupabaseClient(supabaseUrl, keyToUse, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};
