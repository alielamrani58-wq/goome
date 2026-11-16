import type {Place,RideClass} from './goome-types';
export const PAGES=['home','search','vehicles','options','activity','detail','account','favorites','payment','promos','notifications','safety','help','settings','legal','plans','earnings','vehicle','documents','profile-edit','permissions','receipt','rating'] as const;
export type Page=typeof PAGES[number];
export type IconName=keyof typeof import('./figma-assets.json');
export interface Favorite extends Place {id:string;name:string;}
export interface Contact {id:string;name:string;phone:string;}
export interface Plan {id:string;pickup:Place;dropoff:Place;ride_class:RideClass;scheduled_at:string;status:string;}
export interface DriverDocument {user_id:string;kind:string;path:string;name:string;status:'pending'|'approved'|'rejected';updated_at:string;}
export interface AccountData {settings:Record<string,boolean|string>;favorites:Favorite[];contacts:Contact[];plans:Plan[];documents:DriverDocument[];}
export const EMPTY_ACCOUNT:AccountData={settings:{},favorites:[],contacts:[],plans:[],documents:[]};
export const DOCUMENTS=[['license','Permis de conduire','identification'],['vtc','Carte VTC','identification'],['insurance','Attestation d’assurance','file'],['registration','Carte grise','car-neutral'],['inspection','Contrôle technique','shield-check'],['photo','Photo de profil','camera']] as const;
export const PAGE_TITLES:Partial<Record<Page,string>>={activity:'Activité',account:'Compte',favorites:'Lieux favoris',payment:'Moyens de paiement',promos:'Promo et parrainage',notifications:'Notifications',safety:'Sécurité',help:'Aide',settings:'Paramètres',legal:'Mentions légales',plans:'Courses planifiées',earnings:'Revenus',vehicle:'Véhicule et documents',documents:'Vos documents','profile-edit':'Mes informations',permissions:'Pour bien démarrer'};
