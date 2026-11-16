-- Additive follow-up to the initial schema, already applied.
create index if not exists goome_events_actor on goome_private.ride_events(actor_id);
