'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {createClient,type Session,type SupabaseClient} from '@supabase/supabase-js';
import RideMap from './ride-map';
import {PORTALS,canUsePortal} from '@/lib/goome-portals';
import {ACTIVE,CLASSES,inRegion,type Place,type PublicConfig,type Quote,type RideClass,type Snapshot,type Trip,type View} from '@/lib/goome-types';
import {EMPTY_ACCOUNT,PAGES,type Page,type AccountData,type IconName} from '@/lib/portal-pages';
import {Avatar,EmptyState,FIcon,Logo,Modal,PageHeading} from './portal-ui';
import AccountPages from './account-pages';
import AdminDashboard from './admin-dashboard';
import AuthScreen from './auth-screen';
import {ActivityPage,BookingPanel,DriverPanel,TripPanel,TripRoute} from './ride-panels';
const empty:Snapshot={profile:null,driver:null,rides:[],requests:[],profiles:[],drivers:[],online_count:0};

export default function RideApp({portal: view}: {portal: View}) {
  const portal = PORTALS[view];
  const [screen,setScreen]=useState<Page>('home');
  const [accountData,setAccountData]=useState<AccountData>(EMPTY_ACCOUNT);
  const [selectedTrip,setSelectedTrip]=useState<Trip|null>(null);
  const [draftPoint,setDraftPoint]=useState<Place|null>(null);
  const [stars,setStars]=useState(0);
  const [sheetExpanded,setSheetExpanded]=useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [position, setPosition] = useState<Place | null>(null);
  const [picking, setPicking] = useState<'pickup' | 'dropoff' | null>(null);
  const [rideClass, setRideClass] = useState<RideClass>('standard');
  const [quotes,setQuotes]=useState<Partial<Record<RideClass,Quote>>>({});
  const quote=quotes[rideClass]||null;
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<{message: string; error?: boolean} | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'reset' | 'password' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Trip | null>(null);
  const authRole = portal.signupRole;
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const latestLocation = useRef<GeolocationPosition | null>(null);
  const mapSelectionVersion = useRef(0);
  const refreshLock = useRef(false);
  const currentUser = session?.user.id;
  const accountOwner=useRef(currentUser);accountOwner.current=currentUser;
  const accountVersion=useRef(0);
  const visibleRides = snapshot.rides.filter(r => view === 'driver' ? r.driver_id === currentUser : r.passenger_id === currentUser);
  const wrongPortalAccount = !!snapshot.profile && !canUsePortal(view, snapshot.profile.role);
  const activeTrip = visibleRides.find(r => ACTIVE.includes(r.status)) || null;
  const notify = useCallback((message: string, error = false) => setToast({message, error}), []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    fetch('/api/config').then(r => r.json() as Promise<PublicConfig>).then(async (c: PublicConfig) => {
      if (disposed) return; setConfig(c);
      if (!c.configured) return;
      const db = createClient(c.supabaseUrl, c.supabaseKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
      setClient(db);
      const {data} = await db.auth.getSession(); if (!disposed) setSession(data.session);
      const listener = db.auth.onAuthStateChange((event, next) => {setSession(next); if (event === 'PASSWORD_RECOVERY') setAuthMode('password');});
      unsubscribe = () => listener.data.subscription.unsubscribe();
    }).catch(() => {setConfig({configured:false,supabaseUrl:'',supabaseKey:'',quotingEnabled:false});notify('Le service de connexion est indisponible. Réessayez dans un instant.',true);});
    return () => {disposed = true; unsubscribe?.();};
  }, [notify]);

  const rpc = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    if (!client) throw new Error('La connexion aux comptes sera disponible une fois la base activée.');
    const {data, error} = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }, [client]);

  const refresh = useCallback(async () => {
    if (!client || !currentUser || refreshLock.current) return;
    refreshLock.current = true;
    try {
      let state = await rpc('goome_snapshot') as Snapshot;
      if (!state.profile) {
        const {data: {user}} = await client.auth.getUser();
        if (!user) throw new Error('Veuillez vous reconnecter.');
        await rpc('goome_register', {p_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Passager', p_role: user.user_metadata.requested_role === 'driver' ? 'driver' : 'passenger', p_phone: user.user_metadata.phone || ''});
        state = await rpc('goome_snapshot') as Snapshot;
      }
      if(accountOwner.current===currentUser){setSnapshot(state); setSyncError('');}
    } catch (e) { setSyncError(e instanceof Error ? e.message : 'Connexion interrompue.'); }
    finally { refreshLock.current = false; }
  }, [client, currentUser, rpc]);

  useEffect(() => {
    if (!client || !currentUser) {setSnapshot(empty); return;}
    void refresh();
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void refresh();}, 5_000);
    const onVisible = () => {if (document.visibilityState === 'visible') void refresh();};
    document.addEventListener('visibilitychange', onVisible);
    const channel = client.channel(`goome-${currentUser}`).on('postgres_changes', {event: '*', schema: 'public', table: 'goome_rides'}, () => void refresh()).subscribe();
    return () => {clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); void client.removeChannel(channel);};
  }, [client, currentUser, refresh]);

  useEffect(()=>{
    if(view!=='passenger'||!pickup||!dropoff||activeTrip){setQuotes({});return;}
    const controller=new AbortController();setQuoteBusy(true);setQuotes({});
    const timer=setTimeout(async()=>{
      const results=await Promise.allSettled(CLASSES.map(async c=>{
        const response=await fetch('/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup,dropoff,rideClass:c.id}),signal:controller.signal});
        const data=await response.json() as Quote&{error?:string};if(!response.ok)throw new Error(data.error||'Calcul indisponible.');if(!controller.signal.aborted)setQuotes(previous=>({...previous,[c.id]:data}));
      }));
      if(!controller.signal.aborted){setQuoteBusy(false);const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')notify(failure.reason instanceof Error?failure.reason.message:'Calcul indisponible.',true);}
    },200);
    return()=>{clearTimeout(timer);controller.abort();setQuoteBusy(false);};
  },[view,pickup,dropoff,activeTrip?.id,notify]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {notify('La localisation n’est pas disponible sur cet appareil. Choisissez une adresse.', true); return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async p => {
      const place = {latitude: p.coords.latitude, longitude: p.coords.longitude, label: 'Ma position actuelle'};
      setPosition(place); latestLocation.current = p;
      if (!inRegion(place)) {setLocating(false); notify('Votre position est hors Île-de-France. Vous pouvez choisir une adresse dans la région.', true); return;}
      try {const response = await fetch(`/api/geocode?lat=${place.latitude}&lon=${place.longitude}`); const result = await response.json() as {places?: Place[]}; if (result.places?.[0]) place.label = result.places[0].label;} catch { /* Coordinates remain usable if reverse geocoding is unavailable. */ }
      setPickup(place); setLocating(false); setPicking(null);
    }, e => {setLocating(false); notify(e.code === 1 ? 'Autorisez la localisation dans votre navigateur, ou saisissez votre adresse.' : 'Votre position est indisponible. Réessayez ou saisissez votre adresse.', true);}, {enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000});
  }, [notify]);

  useEffect(() => {
    if (view !== 'driver' || !snapshot.driver?.online || !client || !currentUser || !navigator.geolocation) return;
    let lastSent = 0, sending = false, stopped = false;
    const publish = async () => {
      const p = latestLocation.current;
      if (!p || Date.now() - p.timestamp > 30_000 || Date.now() - lastSent < 4_000 || sending || stopped) return;
      sending = true; lastSent = Date.now();
      try {await rpc('goome_location', {p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy: p.coords.accuracy});}
      catch (e) {notify(e instanceof Error ? e.message : 'Votre position n’a pas pu être partagée.', true);}
      finally {sending = false;}
    };
    const watch = navigator.geolocation.watchPosition(p => {latestLocation.current = p; setPosition({latitude: p.coords.latitude, longitude: p.coords.longitude, label: 'Votre position'}); void publish();}, () => {notify('Le partage de position s’est interrompu. Repassez en ligne après avoir autorisé la localisation.', true); void rpc('goome_online', {p_online: false}).then(refresh).catch(() => {});}, {enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000});
    const heartbeat = setInterval(() => navigator.geolocation.getCurrentPosition(p => {latestLocation.current = p; void publish();}, () => {}, {enableHighAccuracy: true, maximumAge: 0, timeout: 10_000}), 15_000);
    return () => {stopped = true; navigator.geolocation.clearWatch(watch); clearInterval(heartbeat);};
  }, [view, snapshot.driver?.online, client, currentUser, rpc, notify, refresh]);

  const run = async (operation: () => Promise<void>) => {setBusy(true); try {await operation(); await refresh();} catch (e) {notify(e instanceof Error ? e.message : 'Une erreur est survenue.', true);} finally {setBusy(false);}};
  const openAuth = (mode: 'login' | 'signup' = 'login') => {setAuthMode(mode); setAuthError(''); setAuthMessage('');};
  const requestRide = () => {
    if (!session) {openAuth('signup'); return;}
    if (!quote?.signature) {notify('La réservation sera disponible après l’activation de la base.', true); return;}
    if (Date.now() > quote.expiresAt) {setPickup(p => p ? {...p} : p); notify('L’estimation a expiré. Nous recalculons votre trajet.'); return;}
    void run(async () => {await rpc('goome_request', {p_quote: quote.raw, p_signature: quote.signature}); notify('Votre demande a été envoyée aux chauffeurs disponibles.');goTo('home');});
  };
  const action = (trip: Trip, step: string) => void run(async () => {await rpc('goome_trip_action', {p_ride: trip.id, p_action: step, p_version: trip.version}); setConfirmCancel(null);if(step==='complete'){setSelectedTrip({...trip,status:'completed'});goTo('receipt');}else if(step==='accept'||step==='cancel')goTo('home');});
  const goOnline = () => void run(async () => {
    if (snapshot.driver?.online) {await rpc('goome_online', {p_online: false}); return;}
    if (!navigator.geolocation) throw new Error('La localisation est requise pour passer en ligne.');
    const p = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Autorisez la localisation pour recevoir des demandes.')), {enableHighAccuracy: true, timeout: 15_000, maximumAge: 0}));
    latestLocation.current = p;
    await rpc('goome_location', {p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy: p.coords.accuracy});
    await rpc('goome_online', {p_online: true});
  });
  const submitAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setAuthError(''); setAuthMessage('');
    if (!client) {setAuthError('La base de comptes est en cours d’activation. La carte et le calcul d’itinéraire sont déjà disponibles.'); return;}
    const f = new FormData(e.currentTarget); setBusy(true);
    try {
      const email = String(f.get('email') || '').trim(), password = String(f.get('password') || '');
      if (authMode === 'reset') {const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo: window.location.origin}); if (error) throw error; setAuthMessage('Si ce compte existe, un lien de réinitialisation vous a été envoyé.');}
      else if (authMode === 'password') {const {error} = await client.auth.updateUser({password}); if (error) throw error; setAuthMode(null); notify('Votre mot de passe a été mis à jour.');}
      else if (authMode === 'signup') {
        const {data, error} = await client.auth.signUp({email, password, options: {emailRedirectTo: window.location.origin, data: {full_name: String(f.get('name') || '').trim(), phone: String(f.get('phone') || '').trim(), requested_role: authRole}}});
        if (error) throw error;
        if (data.session) {setSession(data.session); setAuthMode(null); notify('Bienvenue chez Goöme.');goTo(view==='passenger'?'permissions':'home');}
        else setAuthMessage('Consultez votre boîte mail et confirmez votre adresse, puis connectez-vous.');
      } else {const {data, error} = await client.auth.signInWithPassword({email, password}); if (error) throw error; setSession(data.session); setAuthMode(null); notify('Heureux de vous revoir.');}
    } catch (e) {setAuthError(e instanceof Error ? e.message : 'La connexion a échoué.');}
    finally {setBusy(false);}
  };
  const saveVehicle = (e: FormEvent<HTMLFormElement>) => {e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => {await rpc('goome_vehicle', {p_vehicle: f.get('vehicle'), p_plate: f.get('plate'), p_color: f.get('color'), p_class: f.get('ride_class')}); notify('Véhicule enregistré. Votre compte doit être validé par l’administration.');});};
  const choosePoint = async (p: Place) => {
    if (!inRegion(p)) {notify('Choisissez un point en Île-de-France.', true); return;}
    const version = ++mapSelectionVersion.current;
    const field = picking; setPicking(null);
    if (field === 'pickup') setPickup(p); else setDropoff(p);
    try {const response = await fetch(`/api/geocode?lat=${p.latitude}&lon=${p.longitude}`); const result = await response.json() as {places?: Place[]}; if (version === mapSelectionVersion.current && result.places?.[0]) {const named = {...p, label: result.places[0].label}; if (field === 'pickup') setPickup(named); else setDropoff(named);}} catch { /* Map-selected coordinates remain valid. */ }
  };
  const logout = () => void run(async () => {if (view === 'driver' && snapshot.driver?.online && !activeTrip) await rpc('goome_online', {p_online: false}); await client?.auth.signOut(); setSession(null); setSnapshot(empty);setAccountData(EMPTY_ACCOUNT);goTo('home');});

  const goTo = useCallback((page:Page) => {setScreen(page);if(typeof window!=='undefined'){const url=new URL(window.location.href);if(page==='home')url.searchParams.delete('page');else url.searchParams.set('page',page);window.history.pushState({page},'',url);}},[]);
  const loadAccount = useCallback(async()=>{if(!client||!currentUser||!snapshot.profile)return;const version=++accountVersion.current;const account=await rpc('goome_account_data') as AccountData;if(accountOwner.current===currentUser&&version===accountVersion.current)setAccountData(account);},[client,currentUser,snapshot.profile?.id,rpc]);
  const reloadAll=async()=>{await Promise.all([refresh(),loadAccount()]);};
  useEffect(()=>{const read=()=>{const page=new URL(window.location.href).searchParams.get('page');setScreen(PAGES.includes(page as Page)?page as Page:'home');};read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);},[]);
  useEffect(()=>{if(!currentUser){setAccountData(EMPTY_ACCOUNT);return;}const update=()=>{if(document.visibilityState==='visible'&&snapshot.profile)void loadAccount().catch(e=>notify(e.message,true));};update();const timer=setInterval(update,15000);return()=>clearInterval(timer);},[loadAccount,currentUser,notify]);
  const previousTrip=useRef<string|null>(null);
  useEffect(()=>{const before=previousTrip.current;previousTrip.current=activeTrip?.id||null;if(before&&!activeTrip){const done=visibleRides.find(r=>r.id===before&&r.status==='completed');if(done){setSelectedTrip(done);goTo('receipt');}}},[activeTrip?.id,snapshot.rides,goTo]);
  const displayTrip=visibleRides.find(r=>r.id===selectedTrip?.id)||selectedTrip;
  useEffect(()=>{setStars(displayTrip?.rating||0);},[displayTrip?.id,displayTrip?.rating]);
  const showTrip=(trip:Trip)=>{setSelectedTrip(trip);goTo('detail');};
  const plan=(p:{pickup:Place;dropoff:Place;ride_class:RideClass})=>{if(p.pickup.latitude!==p.dropoff.latitude||p.pickup.longitude!==p.dropoff.longitude)setPickup(p.pickup);setDropoff(p.dropoff);setRideClass(p.ride_class);goTo(pickup||p.pickup!==p.dropoff?'vehicles':'search');};
  const pickOnMap=(field:'pickup'|'dropoff')=>{setDraftPoint(null);setPicking(field);goTo('search');};
  const pickDraft=async(place:Place)=>{const selection=++mapSelectionVersion.current;setDraftPoint(place);try{const response=await fetch(`/api/geocode?lat=${place.latitude}&lon=${place.longitude}`);const data=await response.json() as {places?:Place[]};if(selection===mapSelectionVersion.current&&data.places?.[0])setDraftPoint(data.places[0]);}catch{/* Coordinates remain usable. */}};
  const confirmPoint=()=>{if(!draftPoint)return;const field=picking;void choosePoint(draftPoint);setDraftPoint(null);goTo(field==='pickup'&&dropoff||field==='dropoff'&&pickup?'vehicles':'search');};
  const favorites=(name:string)=>{const place=accountData.favorites.find(f=>f.name.toLocaleLowerCase('fr-FR')===name.toLocaleLowerCase('fr-FR'));if(place){setDropoff(place);goTo(pickup?'vehicles':'search');}else goTo('favorites');};
  const isMapPage=view!=='admin'&&['home','search','vehicles','options','receipt','rating'].includes(screen);
  const fullPage=!isMapPage;
  const navItems:{page:Page;label:string;icon:IconName}[]=view==='driver'?[{page:'home',label:'Conduite',icon:'drive-active'},{page:'earnings',label:'Revenus',icon:'euro'},{page:'activity',label:'Historique',icon:'clock'},{page:'account',label:'Profil',icon:'person'}]:[{page:'home',label:'Trajet',icon:'house1'},{page:'activity',label:'Activité',icon:'clock'},{page:'account',label:'Compte',icon:'person'}];
  const accountActive=!['home','search','vehicles','options','activity','plans','earnings','receipt','rating','detail'].includes(screen);
  const navActive=(page:Page)=>page==='home'?isMapPage:page==='account'?accountActive:screen===page;
  const header=<div className="panel-brand"><Logo onClick={()=>{setPicking(null);goTo('home');}}/><div className="brand-actions"><button className="notification-button" aria-label="Notifications" onClick={()=>goTo('notifications')}><FIcon name="bell"/></button><button className="avatar-button" aria-label={session?'Mon compte':'Se connecter'} onClick={()=>session?goTo('account'):openAuth()}><Avatar name={snapshot.profile?.full_name||'G'}/></button></div></div>;
  const bottom=<nav className="bottom-nav" aria-label="Navigation principale">{navItems.map(n=><button key={n.page} className={navActive(n.page)?'selected':''} aria-current={navActive(n.page)?'page':undefined} onClick={()=>{setPicking(null);goTo(n.page);}}><FIcon name={n.page==='home'?(navActive(n.page)?n.icon:view==='driver'?'car-neutral':'house'):navActive(n.page)?n.page==='account'?'person-active':n.page==='earnings'?'euro-active':'clock-active':n.icon} size={29.5}/><span>{n.label}</span></button>)}</nav>;
  const menu=<><span className="portal-label">{portal.label}</span><nav className="side-navigation" aria-label="Menu">{[...navItems.filter(n=>n.page!=='account'),...(view==='passenger'?[{page:'plans' as Page,label:'Courses planifiées',icon:'calendar' as IconName}]:[]),{page:'account' as Page,label:view==='driver'?'Profil':'Compte',icon:'person' as IconName},{page:'safety' as Page,label:'Sécurité',icon:'shield-check' as IconName},{page:'settings' as Page,label:'Paramètres',icon:'gear' as IconName},{page:'help' as Page,label:'Aide',icon:'question' as IconName}].map(n=><button key={n.page} className={(n.page==='account'?accountActive&&!['safety','settings','help'].includes(screen):screen===n.page)?'selected':''} onClick={()=>goTo(n.page)}><FIcon name={n.icon} size={24}/><span>{n.label}</span></button>)}</nav><button className="side-logout" onClick={session?logout:()=>openAuth()}><FIcon name="power"/>{session?'Se déconnecter':'Se connecter'}</button></>;
  return <div className={`app-shell portal-${view} ${isMapPage?'map-layout':'page-layout'} page-${screen}`}>
    {view!=='admin'&&<div className={`map-background ${fullPage?'concealed':''}`}><RideMap pickup={picking==='pickup'&&draftPoint?draftPoint:activeTrip?.pickup||pickup} dropoff={picking==='dropoff'&&draftPoint?draftPoint:activeTrip?.dropoff||dropoff} position={position} coordinates={activeTrip?.status==='requested'?[]:activeTrip?.route||quote?.route.coordinates||[]} trip={activeTrip} picking={picking} selectable={false} onPick={pickDraft} onLocate={locate}/></div>}
    <header className="mobile-header"><Logo compact onClick={()=>goTo('home')}/><div className="brand-actions"><button className="avatar-button" aria-label={session?'Mon compte':'Se connecter'} onClick={()=>session?goTo('account'):openAuth()}><Avatar name={snapshot.profile?.full_name||'G'}/></button></div></header>
    {wrongPortalAccount?<main className="wrong-portal"><EmptyState icon="shield-check" title={`Votre espace ${portal.label.toLowerCase()}`} action={logout} label="Changer de compte">Ce compte ne dispose pas de l’accès à ce site. Connectez-vous avec le compte correspondant.</EmptyState></main>:view==='admin'?<><aside className="desktop-sidebar">{header}<span className="portal-label">Administration</span><div className="admin-side-note"><FIcon name="shield-check" size={40}/><h2>Votre activité,<br/>au même endroit.</h2><p>Chauffeurs, documents, passagers et trajets en Île-de-France.</p></div><button className="side-logout" onClick={session?logout:()=>openAuth()}><FIcon name="power"/>{session?'Se déconnecter':'Se connecter'}</button></aside><AdminDashboard snapshot={snapshot} documents={accountData.documents} busy={busy} login={()=>openAuth()} run={fn=>run(async()=>{await fn();await loadAccount();})} rpc={rpc} cancel={setConfirmCancel} client={client} notify={notify}/></>:<>
      {isMapPage?<section className={`booking-panel ${screen==='home'?'home-panel':''} ${picking?'point-panel':''} ${sheetExpanded?'expanded':''}`} aria-label={view==='driver'?'Conduite':'Réserver un trajet'}><div className="desktop-panel-header">{header}</div><button className="sheet-handle" aria-label={sheetExpanded?"Réduire le panneau":"Agrandir le panneau"} aria-expanded={sheetExpanded} onClick={()=>setSheetExpanded(!sheetExpanded)}><span/></button><div className="panel-scroll">
        {picking?<><h1>Choisissez votre {picking==='pickup'?'départ':'arrivée'}</h1><p className="muted">Touchez la carte pour ajuster votre point.</p><div className="selected-map-point"><FIcon name="pinpoint"/><strong>{draftPoint?.label||'Aucun point sélectionné'}</strong></div><button className="primary-button" disabled={!draftPoint} onClick={confirmPoint}>Confirmer ce point</button><button className="text-button" onClick={()=>{setPicking(null);setDraftPoint(null);}}>Retour à la recherche</button></>:screen==='rating'?displayTrip?<><Avatar name={displayTrip.driver_name||'G'} large/><h1>Comment s’est passé votre trajet{displayTrip.driver_name?` avec ${displayTrip.driver_name.split(' ')[0]}`:''} ?</h1><div className="rating-stars" aria-label="Note du trajet">{[1,2,3,4,5].map(n=><button key={n} aria-label={`Noter ${n} sur 5`} aria-pressed={stars===n} disabled={!!displayTrip.rating||busy} onClick={()=>setStars(n)}><FIcon name={n<=stars?'star1':'star-empty'} size={40}/></button>)}</div><button className="primary-button" disabled={busy||!stars} onClick={()=>displayTrip.rating?goTo('home'):void run(async()=>{await rpc('goome_rate',{p_ride:displayTrip.id,p_rating:stars});notify('Merci pour votre avis.');goTo('home');})}>{displayTrip.rating?'Retour à l’accueil':'Envoyer'}</button><button className="text-button" onClick={()=>goTo('home')}>Passer</button></>:<EmptyState title="Choisissez une course terminée" action={()=>goTo('activity')} label="Voir mon activité"/>:screen==='receipt'&&displayTrip?<TripPanel trip={displayTrip} view={view} busy={busy} action={action} cancel={setConfirmCancel} notify={notify} go={goTo}/>:activeTrip?<TripPanel trip={activeTrip} view={view} busy={busy} action={action} cancel={setConfirmCancel} notify={notify} go={goTo}/>:view==='driver'?<DriverPanel snapshot={snapshot} rides={visibleRides} busy={busy} online={goOnline} go={goTo} login={()=>openAuth()} action={action}/>:<BookingPanel pickup={pickup} dropoff={dropoff} setPickup={setPickup} setDropoff={setDropoff} position={position} screen={screen} go={goTo} setPicking={pickOnMap} locate={locate} locating={locating} rideClass={rideClass} setRideClass={setRideClass} quotes={quotes} quoteBusy={quoteBusy} request={requestRide} busy={busy} data={accountData} onFavorite={favorites}/>}
      </div>{['home','search'].includes(screen)&&!picking&&bottom}</section>:<><aside className="desktop-sidebar">{header}{menu}</aside><main className="page-content">{screen==='activity'?<ActivityPage rides={visibleRides} authenticated={!!session} login={()=>openAuth()} onTrip={showTrip} view={view}/>:screen==='detail'?displayTrip?<><PageHeading title={displayTrip.dropoff.label.split(',')[0]} onBack={()=>goTo('activity')}/><TripPanel trip={displayTrip} view={view} busy={busy} action={action} cancel={setConfirmCancel} notify={notify} go={goTo}/></>:<EmptyState title="Choisissez un trajet" action={()=>goTo('activity')} label="Voir mon activité"/>:<AccountPages page={screen} view={view} profile={snapshot.profile} driver={snapshot.driver} rides={visibleRides} data={accountData} client={client} authenticated={!!session} busy={busy} go={goTo} login={()=>openAuth()} logout={logout} notify={notify} rpc={rpc} reload={reloadAll} saveVehicle={saveVehicle} onPlan={plan} onTrip={showTrip}/>}</main><div className="mobile-page-nav">{bottom}</div></>}
    </>}
    {locating&&<div className="location-progress" role="status">Recherche de votre position…</div>}
    {syncError&&<div className="connection-banner" role="status"><span>{syncError}</span><button onClick={()=>void refresh()}>Réessayer</button></div>}
    {toast&&<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}><FIcon name={toast.error?'info':'checkmark'}/><span>{toast.message}</span><button aria-label="Fermer le message" onClick={()=>setToast(null)}><FIcon name="times" size={20}/></button></div>}
    {authMode&&<AuthScreen mode={authMode} view={view} busy={busy} error={authError} message={authMessage} submit={submitAuth} close={()=>setAuthMode(null)} change={mode=>{setAuthMode(mode);setAuthError('');setAuthMessage('');}} legal={()=>{setAuthMode(null);goTo('legal');}}/>}
    {confirmCancel&&<Modal title="Annuler la course ?" onClose={()=>setConfirmCancel(null)}><div className="info-note"><FIcon name="info"/><p>La demande sera fermée et l’autre personne en sera informée dans Goöme. Aucun frais n’est appliqué pendant ce pilote.</p></div><TripRoute trip={confirmCancel}/><button className="primary-button" disabled={busy} onClick={()=>action(confirmCancel,'cancel')}>Annuler la course</button><button className="secondary-button" onClick={()=>setConfirmCancel(null)}>Garder ma course</button></Modal>}
    {!config&&<div className="startup-screen"><Logo onClick={()=>{}}/><p>On vient vous chercher.</p></div>}
  </div>;
}
