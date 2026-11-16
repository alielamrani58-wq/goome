-- Goöme uses its own prefixed tables and an unexposed private schema.
create schema if not exists goome_private;
create extension if not exists pgcrypto with schema extensions;

create table public.goome_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (length(full_name) between 2 and 100),
  phone text,
  role text not null check (role in ('passenger','driver','admin')),
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.goome_drivers (
  user_id uuid primary key references public.goome_profiles(id) on delete cascade,
  approved boolean not null default false,
  online boolean not null default false,
  vehicle text not null default '', plate text not null default '', color text not null default '',
  ride_class text not null default 'standard' check (ride_class in ('standard','comfort','xl')),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy double precision check (accuracy >= 0 and accuracy < 100000),
  location_at timestamptz
);
create table public.goome_rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.goome_profiles(id),
  driver_id uuid references public.goome_profiles(id),
  status text not null default 'requested' check (status in ('requested','accepted','arrived','in_progress','completed','passenger_cancelled','driver_cancelled','admin_cancelled')),
  version integer not null default 0 check (version >= 0),
  pickup jsonb not null, dropoff jsonb not null,
  fare_minor integer not null check (fare_minor between 1 and 10000000),
  distance_meters double precision not null check (distance_meters > 0 and distance_meters < 1000000),
  duration_seconds double precision not null check (duration_seconds > 0 and duration_seconds < 86400),
  ride_class text not null check (ride_class in ('standard','comfort','xl')),
  route jsonb not null,
  quote_nonce uuid not null unique,
  payment_status text not null default 'cash_due' check (payment_status in ('cash_due','paid')),
  rating integer check (rating between 1 and 5),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (driver_id is null or driver_id <> passenger_id)
);
create unique index goome_one_active_passenger on public.goome_rides(passenger_id) where status in ('requested','accepted','arrived','in_progress');
create unique index goome_one_active_driver on public.goome_rides(driver_id) where driver_id is not null and status in ('accepted','arrived','in_progress');
create index goome_rides_passenger_history on public.goome_rides(passenger_id,created_at desc);
create index goome_rides_driver_history on public.goome_rides(driver_id,created_at desc);
create index goome_pending_requests on public.goome_rides(created_at) where status = 'requested';
create index goome_online_drivers on public.goome_drivers(location_at) where online and approved;
create table goome_private.admin_emails (email text primary key);
create table goome_private.settings (key text primary key, value text not null);
create table goome_private.ride_events (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.goome_rides(id),
  actor_id uuid not null references public.goome_profiles(id),
  action text not null, version integer not null,
  created_at timestamptz not null default now()
);
create index goome_events_ride on goome_private.ride_events(ride_id,created_at);
create index goome_events_actor on goome_private.ride_events(actor_id);
alter table public.goome_profiles enable row level security;
alter table public.goome_drivers enable row level security;
alter table public.goome_rides enable row level security;
alter table goome_private.admin_emails enable row level security;
alter table goome_private.settings enable row level security;
alter table goome_private.ride_events enable row level security;

create function goome_private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.goome_profiles where id = (select auth.uid()) and role = 'admin' and not suspended)
$$;
create function goome_private.account() returns public.goome_profiles language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles;
begin
 if auth.uid() is null then raise exception 'Connectez-vous pour continuer.'; end if;
 select * into p from public.goome_profiles where id = auth.uid();
 if p.id is null then raise exception 'Complétez votre inscription.'; end if;
 if p.suspended then raise exception 'Ce compte est suspendu. Contactez votre administrateur.'; end if;
 return p;
end $$;
create function goome_private.distance(lat1 double precision,lon1 double precision,lat2 double precision,lon2 double precision) returns double precision language sql immutable set search_path = '' as $$
 select 6371000 * 2 * asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)))))
$$;
create policy goome_profile_read on public.goome_profiles for select to authenticated using (id = (select auth.uid()) or (select goome_private.is_admin()));
create policy goome_driver_read on public.goome_drivers for select to authenticated using (user_id = (select auth.uid()) or (select goome_private.is_admin()));
create policy goome_ride_read on public.goome_rides for select to authenticated using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()) or (select goome_private.is_admin()));
grant select on public.goome_profiles,public.goome_drivers,public.goome_rides to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.goome_profiles,public.goome_drivers,public.goome_rides from anon,authenticated;
revoke all on public.goome_profiles,public.goome_drivers,public.goome_rides from anon;

create function goome_private.register(p_name text,p_role text,p_phone text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz; v_role text; result public.goome_profiles;
begin
 if auth.uid() is null then raise exception 'Connectez-vous pour continuer.'; end if;
 if p_role not in ('passenger','driver') or p_role is null then raise exception 'Type de compte invalide.'; end if;
 if length(trim(p_name)) not between 2 and 100 or length(coalesce(p_phone,'')) > 25 then raise exception 'Vérifiez votre nom et votre téléphone.'; end if;
 select lower(email),email_confirmed_at into v_email,v_confirmed from auth.users where id = auth.uid();
 if v_confirmed is null then raise exception 'Confirmez votre adresse email pour continuer.'; end if;
 v_role := case when exists(select 1 from goome_private.admin_emails where email = v_email) then 'admin' else p_role end;
 insert into public.goome_profiles(id,email,full_name,phone,role) values(auth.uid(),v_email,trim(p_name),nullif(trim(p_phone),''),v_role)
 on conflict(id) do nothing;
 select * into result from public.goome_profiles where id = auth.uid();
 if result.role = 'driver' then insert into public.goome_drivers(user_id) values(auth.uid()) on conflict do nothing; end if;
 return to_jsonb(result);
end $$;

create function goome_private.vehicle(p_vehicle text,p_plate text,p_color text,p_class text) returns void language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles;
begin
 p := goome_private.account();
 if p.role <> 'driver' then raise exception 'Un compte chauffeur est nécessaire.'; end if;
 perform 1 from public.goome_drivers where user_id=p.id for update;
 if exists(select 1 from public.goome_rides where driver_id=p.id and status in ('accepted','arrived','in_progress')) then raise exception 'Terminez votre trajet avant de modifier le véhicule.'; end if;
 if coalesce(length(trim(p_vehicle)),0) not between 2 and 100 or coalesce(length(trim(p_plate)),0) not between 4 and 20 or coalesce(length(trim(p_color)),0) not between 2 and 40 or p_class not in ('standard','comfort','xl') or p_class is null then raise exception 'Complétez les informations du véhicule.'; end if;
 update public.goome_drivers set vehicle=trim(p_vehicle),plate=upper(trim(p_plate)),color=trim(p_color),ride_class=p_class,approved=false,online=false where user_id=p.id;
end $$;
create function goome_private.location(p_lat double precision,p_lng double precision,p_accuracy double precision) returns void language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles;
begin
 p := goome_private.account();
 if p.role <> 'driver' then raise exception 'Un compte chauffeur est nécessaire.'; end if;
 if p_lat is null or p_lng is null or p_accuracy is null or not (p_lat between 48.1 and 49.25) or not (p_lng between 1.4 and 3.6) or not (p_accuracy between 0 and 100000) then raise exception 'Une position valide en Île-de-France est nécessaire.'; end if;
 update public.goome_drivers set latitude=p_lat,longitude=p_lng,accuracy=p_accuracy,location_at=now() where user_id=p.id;
end $$;
create function goome_private.online(p_online boolean) returns void language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles; d public.goome_drivers;
begin
 p := goome_private.account();
 select * into d from public.goome_drivers where user_id=p.id for update;
 if p.role <> 'driver' or d.user_id is null or p_online is null then raise exception 'Un compte chauffeur est nécessaire.'; end if;
 if p_online and (not d.approved or d.location_at is null or d.location_at < now()-interval '30 seconds' or d.accuracy > 100 or d.accuracy is null) then raise exception 'Votre profil doit être validé et votre position GPS récente et précise.'; end if;
 if not p_online and exists(select 1 from public.goome_rides where driver_id=p.id and status in ('accepted','arrived','in_progress')) then raise exception 'Terminez ou annulez votre trajet avant de passer hors ligne.'; end if;
 update public.goome_drivers set online=p_online where user_id=p.id;
end $$;

create function goome_private.request(p_quote text,p_signature text) returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles; q jsonb; secret text; ride_id uuid;
begin
 p := goome_private.account();
 if p.role not in ('passenger','admin') then raise exception 'Utilisez un compte passager pour réserver.'; end if;
 select value into secret from goome_private.settings where key='quote_secret';
 if secret is null or p_quote is null or octet_length(p_quote)>200000 or p_signature is null or p_signature <> encode(extensions.hmac(convert_to(p_quote,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex') then raise exception 'Cette estimation est invalide. Recalculez votre trajet.'; end if;
 q := p_quote::jsonb;
 if (q->>'expiresAt')::bigint < extract(epoch from clock_timestamp())*1000 or (q->>'expiresAt')::bigint > extract(epoch from clock_timestamp())*1000+360000 then raise exception 'L’estimation a expiré. Recalculez votre trajet.'; end if;
 if not ((q->'pickup'->>'latitude')::double precision between 48.1 and 49.25) or not ((q->'pickup'->>'longitude')::double precision between 1.4 and 3.6) or not ((q->'dropoff'->>'latitude')::double precision between 48.1 and 49.25) or not ((q->'dropoff'->>'longitude')::double precision between 1.4 and 3.6) then raise exception 'Le trajet doit se situer en Île-de-France.'; end if;
 insert into public.goome_rides(passenger_id,pickup,dropoff,fare_minor,distance_meters,duration_seconds,ride_class,route,quote_nonce)
 values(p.id,q->'pickup',q->'dropoff',(q->>'amount')::integer,(q->>'distance')::double precision,(q->>'duration')::double precision,q->>'rideClass',q->'coordinates',(q->>'nonce')::uuid) returning id into ride_id;
 insert into goome_private.ride_events(ride_id,actor_id,action,version) values(ride_id,p.id,'request',0);
 return ride_id;
exception when unique_violation then raise exception 'Vous avez déjà un trajet en cours, ou cette estimation a déjà été utilisée.';
end $$;

create function goome_private.trip_action(p_ride uuid,p_action text,p_version integer) returns void language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles; r public.goome_rides; d public.goome_drivers; next_status text;
begin
 p := goome_private.account();
 -- Every trip operation takes the ride lock before the driver lock. Uniqueness
 -- constraints also prevent one driver from accepting two different requests.
 select * into r from public.goome_rides where id=p_ride for update;
 if r.id is null then raise exception 'Trajet introuvable.'; end if;
 if p_version is null or r.version <> p_version then raise exception 'Ce trajet a changé. Actualisez avant de réessayer.'; end if;
 if p_action='confirm_cash' then
   if p.id is distinct from r.driver_id or r.status <> 'completed' or r.payment_status='paid' then raise exception 'Seul le chauffeur de ce trajet terminé peut confirmer le règlement.'; end if;
   update public.goome_rides set payment_status='paid',version=version+1,updated_at=now() where id=r.id;
 elsif r.status not in ('requested','accepted','arrived','in_progress') then raise exception 'Ce trajet est déjà terminé.';
 elsif p_action='accept' then
   if p.role <> 'driver' or p.id=r.passenger_id or r.status <> 'requested' or r.driver_id is not null then raise exception 'Cette demande ne peut pas être acceptée.'; end if;
   select * into d from public.goome_drivers where user_id=p.id for update;
   if d.user_id is null or not d.approved or not d.online or d.location_at is null or d.location_at < now()-interval '30 seconds' or d.accuracy is null or d.accuracy>100 or d.ride_class<>r.ride_class or goome_private.distance(d.latitude,d.longitude,(r.pickup->>'latitude')::double precision,(r.pickup->>'longitude')::double precision)>15000 then raise exception 'Votre véhicule, votre disponibilité ou votre position ne permet pas ce trajet.'; end if;
   update public.goome_rides set driver_id=p.id,status='accepted',version=version+1,updated_at=now() where id=r.id;
 elsif p_action='cancel' then
   if p.role='admin' then next_status:='admin_cancelled';
   elsif r.status='in_progress' then raise exception 'Contactez l’administration pour interrompre un trajet commencé.';
   elsif p.id=r.passenger_id then next_status:='passenger_cancelled';
   elsif p.id=r.driver_id then next_status:='driver_cancelled';
   else raise exception 'Vous ne pouvez pas annuler le trajet d’un autre compte.'; end if;
   update public.goome_rides set status=next_status,version=version+1,updated_at=now() where id=r.id;
 else
   if p.id is distinct from r.driver_id or p.role <> 'driver' then raise exception 'Seul le chauffeur attribué peut modifier ce trajet.'; end if;
   if p_action='arrive' and r.status='accepted' then next_status:='arrived';
   elsif p_action='start' and r.status='arrived' then next_status:='in_progress';
   elsif p_action='complete' and r.status='in_progress' then next_status:='completed';
   else raise exception 'Cette étape n’est pas encore disponible.'; end if;
   update public.goome_rides set status=next_status,version=version+1,updated_at=now() where id=r.id;
 end if;
 insert into goome_private.ride_events(ride_id,actor_id,action,version) values(r.id,p.id,p_action,r.version+1);
exception when unique_violation then raise exception 'Vous avez déjà un autre trajet en cours.';
end $$;

create function goome_private.rate(p_ride uuid,p_rating integer) returns void language plpgsql security definer set search_path = '' as $$
declare p public.goome_profiles;
begin
 p:=goome_private.account();
 if p_rating is null or p_rating not between 1 and 5 then raise exception 'La note doit être comprise entre 1 et 5.'; end if;
 update public.goome_rides set rating=p_rating,version=version+1,updated_at=now() where id=p_ride and passenger_id=p.id and status='completed' and rating is null;
 if not found then raise exception 'Ce trajet ne peut pas être noté.'; end if;
end $$;
create function goome_private.admin_driver(p_user uuid,p_approved boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not goome_private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
 perform 1 from public.goome_drivers where user_id=p_user for update;
 if exists(select 1 from public.goome_rides where driver_id=p_user and status in ('accepted','arrived','in_progress')) then raise exception 'Ce chauffeur a un trajet actif.'; end if;
 update public.goome_drivers set approved=p_approved,online=false where user_id=p_user and vehicle<>'' and plate<>'' and p_approved is not null;
 if not found then raise exception 'Ce chauffeur doit compléter son véhicule.'; end if;
end $$;
create function goome_private.admin_suspend(p_user uuid,p_suspended boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not goome_private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
 if exists(select 1 from public.goome_rides where (driver_id=p_user or passenger_id=p_user) and status in ('requested','accepted','arrived','in_progress')) then raise exception 'Annulez ou terminez les trajets actifs de ce compte avant de le suspendre.'; end if;
 update public.goome_profiles set suspended=p_suspended where id=p_user and role<>'admin' and p_suspended is not null;
 if not found then raise exception 'Ce compte ne peut pas être modifié.'; end if;
 if p_suspended then update public.goome_drivers set online=false where user_id=p_user; end if;
end $$;

create function goome_private.snapshot() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.goome_profiles; v_driver public.goome_drivers; rides jsonb; requests jsonb:='[]'::jsonb; profiles jsonb:='[]'::jsonb; drivers jsonb:='[]'::jsonb;
begin
 if auth.uid() is null then raise exception 'Connectez-vous pour continuer.'; end if;
 select * into v_profile from public.goome_profiles where id=auth.uid();
 if v_profile.id is null then return jsonb_build_object('profile',null,'driver',null,'rides','[]'::jsonb,'requests','[]'::jsonb,'profiles','[]'::jsonb,'drivers','[]'::jsonb,'online_count',0); end if;
 if v_profile.suspended then raise exception 'Ce compte est suspendu.'; end if;
 select * into v_driver from public.goome_drivers where user_id=v_profile.id;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into rides from (
   select r.*,pp.full_name passenger_name,pp.phone passenger_phone,dp.full_name driver_name,dp.phone driver_phone,dd.vehicle,dd.plate,
   case when r.status in ('accepted','arrived','in_progress') then dd.latitude end driver_latitude,
   case when r.status in ('accepted','arrived','in_progress') then dd.longitude end driver_longitude,
   case when r.status in ('accepted','arrived','in_progress') then dd.location_at end driver_location_at
   from public.goome_rides r left join public.goome_profiles pp on pp.id=r.passenger_id left join public.goome_profiles dp on dp.id=r.driver_id left join public.goome_drivers dd on dd.user_id=r.driver_id
   where v_profile.role='admin' or r.passenger_id=v_profile.id or r.driver_id=v_profile.id order by r.created_at desc limit 100
 ) t;
 if v_profile.role='driver' and v_driver.online and v_driver.approved and v_driver.location_at > now()-interval '30 seconds' and v_driver.accuracy<=100 and not exists(select 1 from public.goome_rides where driver_id=v_profile.id and status in ('accepted','arrived','in_progress')) then
   select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]'::jsonb) into requests from (
     select r.* from public.goome_rides r join public.goome_profiles pp on pp.id=r.passenger_id
     where r.status='requested' and r.ride_class=v_driver.ride_class and r.passenger_id<>v_profile.id and not pp.suspended and goome_private.distance(v_driver.latitude,v_driver.longitude,(r.pickup->>'latitude')::double precision,(r.pickup->>'longitude')::double precision)<=15000
     order by r.created_at limit 25
   ) t;
 end if;
 if v_profile.role='admin' then
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into profiles from (select * from public.goome_profiles order by created_at desc limit 500) t;
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into drivers from (select dd.*,pp.full_name from public.goome_drivers dd join public.goome_profiles pp on pp.id=dd.user_id order by pp.created_at desc limit 500) t;
 end if;
 return jsonb_build_object('profile',to_jsonb(v_profile),'driver',case when v_driver.user_id is not null then to_jsonb(v_driver) else null end,'rides',rides,'requests',requests,'profiles',profiles,'drivers',drivers,'online_count',(select count(*) from public.goome_drivers dd join public.goome_profiles pp on pp.id=dd.user_id where dd.online and dd.approved and not pp.suspended and dd.location_at>now()-interval '30 seconds' and dd.accuracy<=100));
end $$;

-- Public API wrappers use invoker rights. The checked privileged implementations
-- and signing key are in the private schema, outside the exposed Data API.
create function public.goome_register(p_name text,p_role text,p_phone text default '') returns jsonb language sql security invoker set search_path='' as $$select goome_private.register(p_name,p_role,p_phone)$$;
create function public.goome_vehicle(p_vehicle text,p_plate text,p_color text,p_class text) returns void language sql security invoker set search_path='' as $$select goome_private.vehicle(p_vehicle,p_plate,p_color,p_class)$$;
create function public.goome_location(p_lat double precision,p_lng double precision,p_accuracy double precision) returns void language sql security invoker set search_path='' as $$select goome_private.location(p_lat,p_lng,p_accuracy)$$;
create function public.goome_online(p_online boolean) returns void language sql security invoker set search_path='' as $$select goome_private.online(p_online)$$;
create function public.goome_request(p_quote text,p_signature text) returns uuid language sql security invoker set search_path='' as $$select goome_private.request(p_quote,p_signature)$$;
create function public.goome_trip_action(p_ride uuid,p_action text,p_version integer) returns void language sql security invoker set search_path='' as $$select goome_private.trip_action(p_ride,p_action,p_version)$$;
create function public.goome_rate(p_ride uuid,p_rating integer) returns void language sql security invoker set search_path='' as $$select goome_private.rate(p_ride,p_rating)$$;
create function public.goome_admin_driver(p_user uuid,p_approved boolean) returns void language sql security invoker set search_path='' as $$select goome_private.admin_driver(p_user,p_approved)$$;
create function public.goome_admin_suspend(p_user uuid,p_suspended boolean) returns void language sql security invoker set search_path='' as $$select goome_private.admin_suspend(p_user,p_suspended)$$;
create function public.goome_snapshot() returns jsonb language sql security invoker set search_path='' as $$select goome_private.snapshot()$$;

revoke all on schema goome_private from public,anon;
grant usage on schema goome_private to authenticated;
revoke all on all tables in schema goome_private from public,anon,authenticated;
revoke all on all sequences in schema goome_private from public,anon,authenticated;
revoke execute on all functions in schema goome_private from public,anon,authenticated;
grant execute on function goome_private.is_admin(),goome_private.register(text,text,text),goome_private.vehicle(text,text,text,text),goome_private.location(double precision,double precision,double precision),goome_private.online(boolean),goome_private.request(text,text),goome_private.trip_action(uuid,text,integer),goome_private.rate(uuid,integer),goome_private.admin_driver(uuid,boolean),goome_private.admin_suspend(uuid,boolean),goome_private.snapshot() to authenticated;
revoke execute on function public.goome_register(text,text,text),public.goome_vehicle(text,text,text,text),public.goome_location(double precision,double precision,double precision),public.goome_online(boolean),public.goome_request(text,text),public.goome_trip_action(uuid,text,integer),public.goome_rate(uuid,integer),public.goome_admin_driver(uuid,boolean),public.goome_admin_suspend(uuid,boolean),public.goome_snapshot() from public,anon;
grant execute on function public.goome_register(text,text,text),public.goome_vehicle(text,text,text,text),public.goome_location(double precision,double precision,double precision),public.goome_online(boolean),public.goome_request(text,text),public.goome_trip_action(uuid,text,integer),public.goome_rate(uuid,integer),public.goome_admin_driver(uuid,boolean),public.goome_admin_suspend(uuid,boolean),public.goome_snapshot() to authenticated;

alter publication supabase_realtime add table public.goome_rides;
notify pgrst,'reload schema';
