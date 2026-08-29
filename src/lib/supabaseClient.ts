import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Fallback logic for client initialization
export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder-url.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const getSupabaseAdmin = () => {
  return createClient<Database>(
    supabaseUrl || 'https://placeholder-url.supabase.co',
    serviceRoleKey || supabaseAnonKey || 'placeholder-key'
  );
};
