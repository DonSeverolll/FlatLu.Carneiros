-- 002_hardening.sql
-- Correções de sessão, throttle de login, pagamento e limites por propriedade.
-- Execute DEPOIS de 001_initial.sql.

-- ---------------------------------------------------------------------------
-- Sessões persistentes (refresh token rotativo, revogável)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    user_agent VARCHAR(400),
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
    ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx
    ON user_sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Throttle de autenticação (defesa contra força bruta, com estado no banco
-- porque em serverless não existe memória compartilhada entre invocações)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(32) NOT NULL,
    identifier VARCHAR(320) NOT NULL,
    succeeded BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_lookup_idx
    ON auth_attempts (scope, identifier, created_at DESC);

-- ---------------------------------------------------------------------------
-- Regras comerciais que estavam hardcoded no front-end
-- ---------------------------------------------------------------------------
ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS min_nights INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS max_guests INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS booking_horizon_days INTEGER NOT NULL DEFAULT 365,
    ADD COLUMN IF NOT EXISTS hold_minutes INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS pix_key TEXT,
    ADD COLUMN IF NOT EXISTS pix_holder_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS payment_instructions TEXT,
    ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
    ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]';

ALTER TABLE properties
    DROP CONSTRAINT IF EXISTS properties_min_nights_valid,
    DROP CONSTRAINT IF EXISTS properties_max_guests_valid,
    DROP CONSTRAINT IF EXISTS properties_horizon_valid,
    DROP CONSTRAINT IF EXISTS properties_hold_valid;
ALTER TABLE properties
    ADD CONSTRAINT properties_min_nights_valid CHECK (min_nights >= 1),
    ADD CONSTRAINT properties_max_guests_valid CHECK (max_guests >= 1),
    ADD CONSTRAINT properties_horizon_valid CHECK (booking_horizon_days BETWEEN 1 AND 1095),
    ADD CONSTRAINT properties_hold_valid CHECK (hold_minutes BETWEEN 5 AND 1440);

-- ---------------------------------------------------------------------------
-- Pagamento: referência legível para conciliação manual (Pix) e provedor
-- ---------------------------------------------------------------------------
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS reference VARCHAR(32),
    ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_unique
    ON payments (reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_reservation_idx ON payments (reservation_id);

-- Uma reserva não deve acumular várias cobranças de sinal pendentes.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending_per_reservation
    ON payments (reservation_id) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- O varredor de holds nunca deve expirar reserva que já recebeu dinheiro.
-- Índice alinhado com a nova cláusula da query.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS reservations_pending_expiry_idx;
CREATE INDEX IF NOT EXISTS reservations_pending_expiry_idx
    ON reservations (expires_at)
    WHERE status = 'PENDING_PAYMENT' AND payment_status = 'PENDING';

CREATE INDEX IF NOT EXISTS reservations_customer_idx ON reservations (customer_id, check_in DESC);
CREATE INDEX IF NOT EXISTS reservations_stay_idx ON reservations (property_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
