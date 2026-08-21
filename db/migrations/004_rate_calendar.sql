-- 004_rate_calendar.sql
-- Substitui a diária única por um calendário de tarifas:
--   * preço por dia da semana (segunda a quinta, sexta, sábado, domingo)
--   * períodos especiais com data (Natal, Réveillon, feriados prolongados)
--   * regras de estadia mínima, inclusive por dia de chegada
--
-- `properties.nightly_rate` continua existindo como tarifa de fallback: uma
-- noite sem regra configurada cai nela, e se ela for 0 a vitrine segue dizendo
-- "sob consulta". Assim nenhuma reserva sai com preço inventado.

-- ---------------------------------------------------------------------------
-- Tarifa por dia da semana. Convenção do PostgreSQL: 0 = domingo, 6 = sábado
-- (igual a EXTRACT(DOW) e a Date.getUTCDay()), para não haver conversão entre
-- banco e aplicação.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_weekdays (
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    nightly_amount NUMERIC(12,2) NOT NULL CHECK (nightly_amount >= 0),
    /* Estadia mínima quando a hospedagem COMEÇA neste dia. É o que impede
       vender a noite de sábado solta quando a regra do imóvel é fim de semana
       fechado. NULL = usa o mínimo geral da propriedade. */
    min_nights_on_arrival INTEGER CHECK (min_nights_on_arrival >= 1),
    /* false = esta noite não é vendida como início de estadia. */
    arrival_allowed BOOLEAN NOT NULL DEFAULT true,
    bookable BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (property_id, weekday)
);

-- ---------------------------------------------------------------------------
-- Períodos especiais. `ends_on` é a ÚLTIMA NOITE incluída, não o check-out —
-- data de saída é sempre o dia seguinte à última noite.
--
-- Preço em uma das duas formas, nunca nas duas:
--   nightly_amount  -> por noite dentro do período
--   package_amount  -> valor fechado pelo bloco inteiro
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    nightly_amount NUMERIC(12,2) CHECK (nightly_amount >= 0),
    package_amount NUMERIC(12,2) CHECK (package_amount >= 0),
    min_nights INTEGER CHECK (min_nights >= 1),
    /* Pacote de Réveillon não se vende pela metade: exige o bloco inteiro. */
    requires_full_period BOOLEAN NOT NULL DEFAULT false,
    /* Maior prioridade vence quando dois períodos cobrem a mesma noite. */
    priority INTEGER NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rate_periods_range_valid CHECK (ends_on >= starts_on),
    CONSTRAINT rate_periods_one_price CHECK ((nightly_amount IS NULL) <> (package_amount IS NULL)),
    CONSTRAINT rate_periods_package_needs_full CHECK (
        package_amount IS NULL OR requires_full_period = true
    )
);

-- Dois períodos ativos de mesma prioridade sobre a mesma noite tornariam o
-- preço indeterminado. O banco recusa em vez de escolher em silêncio.
ALTER TABLE rate_periods DROP CONSTRAINT IF EXISTS rate_periods_no_overlap;
ALTER TABLE rate_periods ADD CONSTRAINT rate_periods_no_overlap EXCLUDE USING gist (
    property_id WITH =,
    priority WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
) WHERE (active = true);

CREATE INDEX IF NOT EXISTS rate_periods_lookup_idx
    ON rate_periods (property_id, starts_on, ends_on) WHERE active = true;

-- ---------------------------------------------------------------------------
-- Memória do cálculo. Sem isso, uma reserva antiga fica sem explicação depois
-- que a tabela de preços muda — e discussão sobre valor cobrado não tem como
-- ser resolvida.
-- ---------------------------------------------------------------------------
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS rate_breakdown JSONB;
