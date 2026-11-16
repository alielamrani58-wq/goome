-- Persistent data for the account, saved places, planned rides and driver pages.
begin;
create function goome_private.valid_place(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return coalesce(jsonb_typeof(p)='object' and length(p->>'label') between 1 and 300 and (p->>'latitude')::double precision between 48.1 and 49.25 and (p->>'longitude')::double precision between 1.4 and 3.6,false);
exception when others then return false;
end $$;
revoke execute on function goome_private.valid_place(jsonb) from public,anon,authenticated;
create table public.goome_account_settings (
 user_id uuid primary key references public.goome_profiles(id) on delete cascade,
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and octet_length(settings::text)<12000),
 favorites jsonb not null default '[]' check(jsonb_typeof(favorites)='array' and jsonb_array_length(favorites)<=20),
 contacts jsonb not null default '[]' check(jsonb_typeof(contacts)='array' and jsonb_array_length(contacts)<=10),
 updated_at timestamptz not null default now()
);
create table public.goome_planned_rides (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.goome_profiles(id) on delete cascade,
 pickup jsonb not null, dropoff jsonb not null, ride_class text not null check(ride_class in ('standard','comfort','xl')),
 scheduled_at timestamptz not null, status text not null default 'planned' check(status in ('planned','cancelled','requested')),
 ride_id uuid references public.goome_rides(id), created_at timestamptz not null default now()
);
create index goome_plans_user_date on public.goome_planned_rides(user_id,scheduled_at desc);
create index goome_plans_ride on public.goome_planned_rides(ride_id);
create table public.goome_driver_documents (
 user_id uuid not null references public.goome_profiles(id) on delete cascade,
 kind text not null check(kind in ('license','vtc','insurance','registration','inspection','photo')),
 path text not null check(length(path)<250), name text not null check(length(name) between 1 and 160),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 updated_at timestamptz not null default now(), primary key(user_id,kind)
);
alter table public.goome_account_settings enable row level security;
alter table public.goome_planned_rides enable row level security;
alter table public.goome_driver_documents enable row level security;
create policy goome_settings_own on public.goome_account_settings for select to authenticated using(user_id=(select auth.uid()));
create policy goome_plans_own on public.goome_planned_rides for select to authenticated using(user_id=(select auth.uid()));
create policy goome_docs_own on public.goome_driver_documents for select to authenticated using(user_id=(select auth.uid()) or (select goome_private.is_admin()));
revoke all on public.goome_account_settings,public.goome_planned_rides,public.goome_driver_documents from public,anon,authenticated;
-- These tables are read through checked RPCs; their schema is not exposed to clients.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('goome-driver-documents','goome-driver-documents',false,5242880,array['application/pdf','image/jpeg','image/png']);
create policy goome_document_read on storage.objects for select to authenticated using(bucket_id='goome-driver-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select goome_private.is_admin())));
create policy goome_document_upload on storage.objects for insert to authenticated with check(bucket_id='goome-driver-documents' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.goome_profiles where id=(select auth.uid()) and role='driver' and not suspended));
create policy goome_document_remove on storage.objects for delete to authenticated using(bucket_id='goome-driver-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);

create function goome_private.account_data() returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account(); result jsonb;
begin
 select to_jsonb(s) into result from public.goome_account_settings s where user_id=p.id;
 return jsonb_build_object('settings',coalesce(result->'settings','{}'::jsonb),'favorites',coalesce(result->'favorites','[]'::jsonb),'contacts',coalesce(result->'contacts','[]'::jsonb),
 'plans',(select coalesce(jsonb_agg(to_jsonb(t) order by scheduled_at),'[]'::jsonb) from (select * from public.goome_planned_rides where user_id=p.id order by scheduled_at desc limit 100)t),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.goome_driver_documents d where user_id=p.id or p.role='admin'));
end $$;
create function goome_private.account_save(p_section text,p_value jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account(); v jsonb;
begin
 if p_value is null or octet_length(p_value::text)>12000 then raise exception 'Données trop volumineuses.'; end if;
 if p_section='settings' and jsonb_typeof(p_value)<>'object' then raise exception 'Réglages invalides.'; end if;
 if p_section='favorites' then
  if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)>20 then raise exception '20 lieux favoris au maximum.'; end if;
  for v in select value from jsonb_array_elements(p_value) loop
   if not goome_private.valid_place(v) or length(coalesce(v->>'name','')) not between 1 and 60 then raise exception 'Lieu favori invalide.'; end if;
  end loop;
 elsif p_section='contacts' then
  if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)>10 then raise exception '10 contacts au maximum.'; end if;
  for v in select value from jsonb_array_elements(p_value) loop
   if length(coalesce(v->>'name','')) not between 1 and 100 or length(coalesce(v->>'phone','')) not between 6 and 25 then raise exception 'Vérifiez le nom et le téléphone.'; end if;
  end loop;
 elsif p_section<>'settings' then raise exception 'Rubrique invalide.';
 end if;
 insert into public.goome_account_settings(user_id) values(p.id) on conflict do nothing;
 if p_section='settings' then update public.goome_account_settings set settings=p_value,updated_at=now() where user_id=p.id;
 elsif p_section='favorites' then update public.goome_account_settings set favorites=p_value,updated_at=now() where user_id=p.id;
 else update public.goome_account_settings set contacts=p_value,updated_at=now() where user_id=p.id; end if;
end $$;
create function goome_private.profile_update(p_name text,p_phone text) returns void language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account();
begin
 if length(trim(p_name)) not between 2 and 100 or length(coalesce(p_phone,''))>25 then raise exception 'Vérifiez votre nom et votre téléphone.'; end if;
 update public.goome_profiles set full_name=trim(p_name),phone=trim(p_phone) where id=p.id;
end $$;
create function goome_private.plan_save(p_pickup jsonb,p_dropoff jsonb,p_class text,p_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account(); result uuid;
begin
 if p.role not in ('passenger','admin') or not goome_private.valid_place(p_pickup) or not goome_private.valid_place(p_dropoff) or p_class is null or p_class not in ('standard','comfort','xl') or p_at is null or p_at<now()+interval '15 minutes' or p_at>now()+interval '30 days' then raise exception 'Choisissez un trajet et une date entre 15 minutes et 30 jours.'; end if;
 if (select count(*) from public.goome_planned_rides where user_id=p.id and status='planned' and scheduled_at>now())>=20 then raise exception '20 trajets planifiés au maximum.'; end if;
 insert into public.goome_planned_rides(user_id,pickup,dropoff,ride_class,scheduled_at) values(p.id,p_pickup,p_dropoff,p_class,p_at) returning id into result;return result;
end $$;
create function goome_private.plan_cancel(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account();
begin update public.goome_planned_rides set status='cancelled' where id=p_id and user_id=p.id and status='planned';if not found then raise exception 'Ce trajet ne peut plus être modifié.';end if;end $$;
create function goome_private.document_save(p_kind text,p_path text,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare p public.goome_profiles:=goome_private.account();
begin
 if p.role<>'driver' or p_kind is null or p_kind not in ('license','vtc','insurance','registration','inspection','photo') or length(p_name) not between 1 and 160 or split_part(p_path,'/',1)<>p.id::text or not exists(select 1 from storage.objects where bucket_id='goome-driver-documents' and name=p_path) then raise exception 'Document non valide.'; end if;
 if exists(select 1 from public.goome_rides where driver_id=p.id and status in ('accepted','arrived','in_progress')) then raise exception 'Terminez votre course avant de remplacer vos documents.'; end if;
 insert into public.goome_driver_documents(user_id,kind,path,name) values(p.id,p_kind,p_path,p_name) on conflict(user_id,kind) do update set path=excluded.path,name=excluded.name,status='pending',updated_at=now();
 update public.goome_drivers set approved=false,online=false where user_id=p.id;
end $$;
create function goome_private.document_review(p_user uuid,p_kind text,p_approved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not goome_private.is_admin() then raise exception 'Accès administrateur requis.'; end if;
 update public.goome_driver_documents set status=case when p_approved then 'approved' else 'rejected' end,updated_at=now() where user_id=p_user and kind=p_kind;
 if not found then raise exception 'Document introuvable.';end if;
 if not p_approved then update public.goome_drivers set approved=false,online=false where user_id=p_user;end if;
end $$;
create function public.goome_account_data() returns jsonb language sql security invoker set search_path='' as $$select goome_private.account_data()$$;
create function public.goome_account_save(p_section text,p_value jsonb) returns void language sql security invoker set search_path='' as $$select goome_private.account_save(p_section,p_value)$$;
create function public.goome_profile_update(p_name text,p_phone text) returns void language sql security invoker set search_path='' as $$select goome_private.profile_update(p_name,p_phone)$$;
create function public.goome_plan_save(p_pickup jsonb,p_dropoff jsonb,p_class text,p_at timestamptz) returns uuid language sql security invoker set search_path='' as $$select goome_private.plan_save(p_pickup,p_dropoff,p_class,p_at)$$;
create function public.goome_plan_cancel(p_id uuid) returns void language sql security invoker set search_path='' as $$select goome_private.plan_cancel(p_id)$$;
create function public.goome_document_save(p_kind text,p_path text,p_name text) returns void language sql security invoker set search_path='' as $$select goome_private.document_save(p_kind,p_path,p_name)$$;
create function public.goome_document_review(p_user uuid,p_kind text,p_approved boolean) returns void language sql security invoker set search_path='' as $$select goome_private.document_review(p_user,p_kind,p_approved)$$;
revoke execute on function goome_private.account_data(),goome_private.account_save(text,jsonb),goome_private.profile_update(text,text),goome_private.plan_save(jsonb,jsonb,text,timestamptz),goome_private.plan_cancel(uuid),goome_private.document_save(text,text,text),goome_private.document_review(uuid,text,boolean) from public,anon;
grant execute on function goome_private.account_data(),goome_private.account_save(text,jsonb),goome_private.profile_update(text,text),goome_private.plan_save(jsonb,jsonb,text,timestamptz),goome_private.plan_cancel(uuid),goome_private.document_save(text,text,text),goome_private.document_review(uuid,text,boolean) to authenticated;
revoke execute on function public.goome_account_data(),public.goome_account_save(text,jsonb),public.goome_profile_update(text,text),public.goome_plan_save(jsonb,jsonb,text,timestamptz),public.goome_plan_cancel(uuid),public.goome_document_save(text,text,text),public.goome_document_review(uuid,text,boolean) from public,anon;
grant execute on function public.goome_account_data(),public.goome_account_save(text,jsonb),public.goome_profile_update(text,text),public.goome_plan_save(jsonb,jsonb,text,timestamptz),public.goome_plan_cancel(uuid),public.goome_document_save(text,text,text),public.goome_document_review(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
