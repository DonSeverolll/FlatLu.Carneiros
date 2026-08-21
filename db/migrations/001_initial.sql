CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE reservation_status AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'EXPIRED');
CREATE TYPE payment_status AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'FAILED');
CREATE TYPE inventory_source AS ENUM ('RESERVATION', 'MAINTENANCE', 'CLEANING', 'OWNER_USE');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'CUSTOMER',
    status user_status NOT NULL DEFAULT 'ACTIVE',
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(32),
    document_number VARCHAR(32),
    avatar_url TEXT,
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL;

CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(180) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Recife',
    currency CHAR(3) NOT NULL DEFAULT 'BRL',
    check_in_time TIME NOT NULL DEFAULT '15:00',
    check_out_time TIME NOT NULL DEFAULT '11:00',
    cleaning_gap_hours INTEGER NOT NULL DEFAULT 4,
    deposit_percentage NUMERIC(5,2) NOT NULL DEFAULT 50.00,
    nightly_rate NUMERIC(12,2) NOT NULL,
    terms_version VARCHAR(32) NOT NULL,
    terms_content TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT properties_gap_valid CHECK (cleaning_gap_hours >= 0),
    CONSTRAINT properties_deposit_valid CHECK (deposit_percentage BETWEEN 0 AND 100),
    CONSTRAINT properties_rate_valid CHECK (nightly_rate >= 0)
);

CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    stay_period DATERANGE GENERATED ALWAYS AS (daterange(check_in, check_out, '[)')) STORED,
    status reservation_status NOT NULL DEFAULT 'PENDING_PAYMENT',
    payment_status payment_status NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
    guest_count INTEGER NOT NULL DEFAULT 1,
    total_amount NUMERIC(12,2) NOT NULL,
    deposit_amount NUMERIC(12,2) NOT NULL,
    terms_accepted BOOLEAN NOT NULL DEFAULT false,
    accepted_terms_version VARCHAR(32),
    accepted_at TIMESTAMPTZ,
    accepted_ip INET,
    idempotency_key VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    CONSTRAINT reservations_dates_valid CHECK (check_out > check_in),
    CONSTRAINT reservations_guests_valid CHECK (guest_count > 0),
    CONSTRAINT reservations_terms_valid CHECK (
        status = 'PENDING_PAYMENT' OR
        (terms_accepted AND accepted_terms_version IS NOT NULL AND accepted_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX reservations_idempotency_unique ON reservations (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX reservations_pending_expiry_idx ON reservations (expires_at) WHERE status = 'PENDING_PAYMENT';

CREATE TABLE inventory_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
    source inventory_source NOT NULL,
    blocked_period TSTZRANGE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inventory_blocks ADD CONSTRAINT inventory_blocks_no_overlap EXCLUDE USING gist (
    property_id WITH =,
    blocked_period WITH &&
) WHERE (active = true);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES reservations(id),
    provider VARCHAR(40) NOT NULL,
    provider_transaction_id VARCHAR(160),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    status payment_status NOT NULL DEFAULT 'PENDING',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_transaction_unique
    ON payments (provider, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL;

CREATE TABLE payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(40) NOT NULL,
    provider_event_id VARCHAR(160) NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    UNIQUE (provider, provider_event_id)
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id),
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO properties (name, slug, description, nightly_rate, terms_version, terms_content)
VALUES ('Flat Praia de Carneiros', 'flat-praia-de-carneiros', 'Flat de alto padrão na Praia de Carneiros.', 0, 'v1', 'Termos de locação pendentes de publicação.');
