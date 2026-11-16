export type View = 'passenger' | 'driver' | 'admin';
export type RideClass = 'standard' | 'comfort' | 'xl';
export interface Place { label: string; latitude: number; longitude: number; }
export interface RouteData { distance: number; duration: number; coordinates: [number, number][]; }
export interface Quote { raw: string; signature: string | null; amount: number; expiresAt: number; route: RouteData; rideClass: RideClass; }
export interface Profile { id: string; full_name: string; email: string; phone: string | null; role: View; suspended: boolean; created_at: string; }
export interface Driver { user_id: string; approved: boolean; online: boolean; vehicle: string; plate: string; color: string; ride_class: RideClass; latitude: number | null; longitude: number | null; accuracy: number | null; location_at: string | null; }
export interface Trip { id: string; passenger_id: string; driver_id: string | null; status: string; version: number; pickup: Place; dropoff: Place; fare_minor: number; distance_meters: number; duration_seconds: number; ride_class: RideClass; route: [number, number][]; payment_status: string; rating: number | null; created_at: string; passenger_name?: string; passenger_phone?: string; driver_name?: string; driver_phone?: string; vehicle?: string; plate?: string; driver_latitude?: number | null; driver_longitude?: number | null; driver_location_at?: string | null; }
export interface Snapshot { profile: Profile | null; driver: Driver | null; rides: Trip[]; requests: Trip[]; profiles: Profile[]; drivers: (Driver & {full_name: string})[]; online_count: number; }
export interface PublicConfig { configured: boolean; supabaseUrl: string; supabaseKey: string; quotingEnabled: boolean; }
export const ACTIVE = ['requested', 'accepted', 'arrived', 'in_progress'];
export const STATUS: Record<string, string> = { requested: 'Recherche de chauffeur', accepted: 'Votre chauffeur arrive', arrived: 'Votre chauffeur est arrivé', in_progress: 'Trajet en cours', completed: 'Trajet terminé', passenger_cancelled: 'Annulé par le passager', driver_cancelled: 'Annulé par le chauffeur', admin_cancelled: 'Annulé par l’administrateur' };
export const CLASSES: {id: RideClass; name: string; subtitle: string; seats: number; multiplier: number}[] = [
  {id: 'standard', name: 'Berline', subtitle: 'L’essentiel, tout simplement.', seats: 4, multiplier: 1},
  {id: 'comfort', name: 'Confort', subtitle: 'Un peu plus d’espace pour vous.', seats: 4, multiplier: 1.3},
  {id: 'xl', name: 'Van', subtitle: 'Vos proches font partie du voyage.', seats: 6, multiplier: 1.6},
];
export const money = (minor: number) => new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR'}).format(minor / 100);
export const when = (date: string) => new Intl.DateTimeFormat('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(date));
export const inRegion = (p: {latitude: number; longitude: number}) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.latitude >= 48.1 && p.latitude <= 49.25 && p.longitude >= 1.4 && p.longitude <= 3.6;
