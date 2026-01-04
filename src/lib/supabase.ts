import { createClient } from '@supabase/supabase-js';

// Supabase 설정 (환경변수에서 가져옴)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 환경변수 디버깅
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase 환경변수 누락:', {
    VITE_SUPABASE_URL: supabaseUrl ? '설정됨' : '누락',
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? '설정됨' : '누락'
  });
}

// 기본값 제공 (배포 시 환경변수로 덮어씀)
const finalUrl = supabaseUrl || 'https://xhvponkrbihlndqkscwz.supabase.co';
const finalKey = supabaseAnonKey || 'missing-key';

export const supabase = createClient(finalUrl, finalKey);
