import { upstream } from '@/lib/goome-server';
import { inRegion } from '@/lib/goome-types';
export async function GET(request: Request) {
  try {
    const input = new URL(request.url).searchParams;
    const reverse = input.has('lat') && input.has('lon');
    const url = new URL(`https://data.geopf.fr/geocodage/${reverse ? 'reverse' : 'search'}`);
    if (reverse) {
      const lat = Number(input.get('lat')), lon = Number(input.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return Response.json({error: 'Position invalide.'}, {status: 400});
      url.searchParams.set('lat', String(lat)); url.searchParams.set('lon', String(lon)); url.searchParams.set('limit', '1');
    } else {
      const q = input.get('q')?.trim() || '';
      if (q.length < 3 || q.length > 180) return Response.json({places: []});
      url.searchParams.set('q', q); url.searchParams.set('limit', '10'); url.searchParams.set('lon', '2.3522'); url.searchParams.set('lat', '48.8566'); url.searchParams.set('index', 'address,poi');
    }
    const data = await upstream<{features: {geometry: {coordinates: number[]}; properties: {label?: string | string[]; name?: string | string[]}}[]}>(url);
    const places = (data.features || []).map((f: {geometry: {coordinates: number[]}; properties: {label?: string | string[]; name?: string | string[]}}) => ({label: [f.properties.label || f.properties.name || 'Position sélectionnée'].flat().join(', '), longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1]})).filter(inRegion).slice(0, 5);
    return Response.json({places}, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({error: 'La recherche d’adresse est indisponible. Vous pouvez choisir un point sur la carte.'}, {status: 502});
  }
}
