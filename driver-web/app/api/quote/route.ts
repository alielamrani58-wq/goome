import { inRegion, CLASSES, type Place, type RideClass } from '@/lib/goome-types';
import { getPortal, settings, signQuote, upstream } from '@/lib/goome-server';
export async function POST(request: Request) {
  if (getPortal() !== 'passenger') return Response.json({error: 'La réservation est disponible sur le site passager.'}, {status: 403});
  try {
    if (Number(request.headers.get('content-length') || 0) > 8000) return Response.json({error: 'Demande trop volumineuse.'}, {status: 413});
    const body = await request.json() as {pickup: Place; dropoff: Place; rideClass: RideClass};
    if (!body.pickup || !body.dropoff || !inRegion(body.pickup) || !inRegion(body.dropoff) || typeof body.pickup.label !== 'string' || typeof body.dropoff.label !== 'string') return Response.json({error: 'Choisissez deux adresses en Île-de-France.'}, {status: 400});
    const selected = CLASSES.find(c => c.id === body.rideClass);
    if (!selected) return Response.json({error: 'Catégorie inconnue.'}, {status: 400});
    const url = new URL('https://data.geopf.fr/navigation/itineraire');
    for (const [key, value] of Object.entries({resource: 'bdtopo-osrm', start: `${body.pickup.longitude},${body.pickup.latitude}`, end: `${body.dropoff.longitude},${body.dropoff.latitude}`, profile: 'car', optimization: 'fastest', geometryFormat: 'geojson', distanceUnit: 'meter', timeUnit: 'second', getSteps: 'false'})) url.searchParams.set(key, value);
    const data = await upstream<{distance: number; duration: number; geometry: {coordinates: [number, number][]}}>(url);
    if (!Number.isFinite(data.distance) || data.distance < 100 || !Number.isFinite(data.duration) || data.duration < 0 || !Array.isArray(data.geometry?.coordinates)) return Response.json({error: 'Choisissez un trajet routier d’au moins 100 mètres.'}, {status: 400});
    const route = {distance: data.distance, duration: data.duration, coordinates: data.geometry.coordinates};
    const amount = Math.max(700, Math.round((250 + data.distance / 1000 * 145 + data.duration / 60 * 25) * selected.multiplier));
    const expiresAt = Date.now() + 5 * 60_000;
    const raw = JSON.stringify({nonce: crypto.randomUUID(), pickup: {...body.pickup, label: body.pickup.label.slice(0, 240)}, dropoff: {...body.dropoff, label: body.dropoff.label.slice(0, 240)}, rideClass: selected.id, distance: data.distance, duration: data.duration, amount, expiresAt, coordinates: route.coordinates});
    const secret = settings().GOOME_QUOTE_SECRET;
    return Response.json({raw, signature: secret ? await signQuote(raw, secret) : null, amount, expiresAt, route, rideClass: selected.id}, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({error: 'Le calcul de votre trajet a échoué. Réessayez dans un instant.'}, {status: 502});
  }
}
