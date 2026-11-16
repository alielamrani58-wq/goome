import type { View } from './goome-types';

export const PORTALS = {
  passenger: {label: 'Passager', title: 'Goöme Passager — La ville est à vous', description: 'Réservez et suivez vos trajets en Île-de-France avec Goöme.', signupRole: 'passenger'},
  driver: {label: 'Chauffeur', title: 'Goöme Chauffeur — Votre rythme, votre route', description: 'Votre espace chauffeur Goöme : véhicule, disponibilité et trajets en Île-de-France.', signupRole: 'driver'},
  admin: {label: 'Administration', title: 'Goöme Administration — Votre activité', description: 'Administration Goöme : chauffeurs, comptes et trajets en Île-de-France.', signupRole: 'passenger'},
} as const;

export function resolvePortal(value?: string): View {
  if (!value) return 'passenger';
  if (value === 'passenger' || value === 'driver' || value === 'admin') return value;
  throw new Error('GOOME_SITE_ROLE must be passenger, driver or admin.');
}

export function canUsePortal(portal: View, accountRole: View): boolean {
  return portal === accountRole || (portal === 'passenger' && accountRole === 'admin');
}
