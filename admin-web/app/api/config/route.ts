import { getPortal, settings } from '@/lib/goome-server';
export function GET() {
  const s = settings();
  return Response.json({configured: !!(s.SUPABASE_URL && s.SUPABASE_PUBLISHABLE_KEY), supabaseUrl: s.SUPABASE_URL || '', supabaseKey: s.SUPABASE_PUBLISHABLE_KEY || '', portal: getPortal(), quotingEnabled: getPortal() === 'passenger' && !!s.GOOME_QUOTE_SECRET}, {headers: {'Cache-Control': 'no-store'}});
}
