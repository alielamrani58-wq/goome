CREATE TABLE IF NOT EXISTS app_metadata (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO app_metadata VALUES ('environment','goome-local-payments-test-v1') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, role text NOT NULL CHECK(role IN ('passenger','driver','admin')),
 name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 stripe_customer text UNIQUE, stripe_recipient text UNIQUE,
 recipient_status text NOT NULL DEFAULT 'not_created', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), role text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rides (
 id text PRIMARY KEY, passenger_id text NOT NULL REFERENCES users(id), driver_id text REFERENCES users(id),
 route_code text NOT NULL, fare integer NOT NULL CHECK(fare BETWEEN 700 AND 10000),
 driver_amount integer NOT NULL CHECK(driver_amount > 0 AND driver_amount < fare),
 currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
 status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','requested','accepted','arrived','in_progress','completed','cancelled')),
 payment text NOT NULL DEFAULT 'checkout_pending',
 desired text NOT NULL DEFAULT 'authorize' CHECK(desired IN ('authorize','capture','cancel','refund')),
 stripe_session text UNIQUE, checkout_url text, stripe_intent text UNIQUE,
 stripe_transfer text UNIQUE, stripe_refund text UNIQUE,
 transfer_reversed boolean NOT NULL DEFAULT false,
 captured integer NOT NULL DEFAULT 0, refunded integer NOT NULL DEFAULT 0,
 capture_before timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_passenger ON rides(passenger_id)
 WHERE status NOT IN ('completed','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS one_active_driver ON rides(driver_id)
 WHERE driver_id IS NOT NULL AND status NOT IN ('completed','cancelled');
CREATE TABLE IF NOT EXISTS operations (
 id text PRIMARY KEY, ride_id text REFERENCES rides(id), user_id text REFERENCES users(id),
 kind text NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','done','review')),
 attempts integer NOT NULL DEFAULT 0, first_attempt_at timestamptz,
 retry_at timestamptz NOT NULL DEFAULT now(), last_error text,
 external_id text, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_events (
 id text PRIMARY KEY, type text NOT NULL, object_id text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL, action text NOT NULL, ride_id text,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_ops ON operations(retry_at) WHERE state='queued';
CREATE INDEX IF NOT EXISTS ride_passenger ON rides(passenger_id,created_at DESC);
-- No TCP listener, Supabase endpoint, browser SQL access or production credentials.
-- Only the local server opens this PGlite PostgreSQL directory.
