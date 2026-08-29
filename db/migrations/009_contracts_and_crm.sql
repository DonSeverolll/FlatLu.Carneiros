-- 009_contracts_and_crm.sql
-- Base para: contrato assinável antes do pagamento, área do cliente,
-- observações na agenda, CRM e gestão de usuários.

-- ---------------------------------------------------------------------------
-- LOCADORA. Sai do código de propósito: é dado jurídico que muda (endereço,
-- estado civil) e quem edita é o escritório, não um deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS landlords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(160) NOT NULL,
    nationality VARCHAR(60) NOT NULL DEFAULT 'brasileira',
    marital_status VARCHAR(60),
    profession VARCHAR(80),
    rg VARCHAR(40),
    rg_issuer VARCHAR(40),
    cpf VARCHAR(20) NOT NULL,
    address_line VARCHAR(240) NOT NULL,
    city VARCHAR(120) NOT NULL,
    state CHAR(2) NOT NULL,
    zip VARCHAR(12) NOT NULL,
    email VARCHAR(320),
    phone VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO landlords (full_name, marital_status, profession, rg, rg_issuer, cpf,
                       address_line, city, state, zip)
SELECT 'LÚCIA VITÓRIA ARCOVERDE TEIXEIRA', 'solteira', 'closer',
       '9.032.331', 'SDS/PE', '107.250.094-97',
       'Avenida Conde da Boa Vista, nº 1482, Apt 212, Bairro da Boa Vista',
       'Recife', 'PE', '50060-001'
WHERE NOT EXISTS (SELECT 1 FROM landlords);

-- ---------------------------------------------------------------------------
-- Endereço e foro por unidade: a Cláusula Primeira descreve o imóvel e a
-- Oitava elege a comarca, que difere entre Tamandaré e São José.
-- ---------------------------------------------------------------------------
ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS landlord_id UUID REFERENCES landlords(id),
    ADD COLUMN IF NOT EXISTS property_kind VARCHAR(40) NOT NULL DEFAULT 'FLAT',
    ADD COLUMN IF NOT EXISTS address_line VARCHAR(240),
    ADD COLUMN IF NOT EXISTS address_city VARCHAR(120),
    ADD COLUMN IF NOT EXISTS address_state CHAR(2),
    ADD COLUMN IF NOT EXISTS address_zip VARCHAR(12),
    ADD COLUMN IF NOT EXISTS legal_forum VARCHAR(120);

UPDATE properties SET landlord_id = (SELECT id FROM landlords ORDER BY created_at LIMIT 1)
WHERE landlord_id IS NULL;

UPDATE properties SET
    property_kind = 'FLAT',
    address_line = 'Rua Quarenta e Sete, nº 113',
    address_city = 'Tamandaré',
    address_state = 'PE',
    address_zip = '55578-000',
    legal_forum = 'Tamandaré'
WHERE slug = 'flat-praia-de-carneiros';

-- Os dois andares de São José ficam sem logradouro: o endereço não foi
-- informado. A geração de contrato recusa até que seja preenchido, em vez de
-- emitir um instrumento com o imóvel identificado pela metade.
UPDATE properties SET
    property_kind = 'CASA',
    address_city = 'São José da Coroa Grande',
    address_state = 'PE',
    legal_forum = 'São José da Coroa Grande'
WHERE slug IN ('casa-sao-jose-terreo', 'casa-sao-jose-primeiro-andar');

-- ---------------------------------------------------------------------------
-- Qualificação do LOCATÁRIO. O contrato exige RG, CPF e endereço completos.
-- ---------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rg VARCHAR(40),
    ADD COLUMN IF NOT EXISTS rg_issuer VARCHAR(40),
    ADD COLUMN IF NOT EXISTS nationality VARCHAR(60) DEFAULT 'brasileira',
    ADD COLUMN IF NOT EXISTS marital_status VARCHAR(60),
    ADD COLUMN IF NOT EXISTS profession VARCHAR(80),
    ADD COLUMN IF NOT EXISTS address_line VARCHAR(240),
    ADD COLUMN IF NOT EXISTS address_city VARCHAR(120),
    ADD COLUMN IF NOT EXISTS address_state CHAR(2),
    ADD COLUMN IF NOT EXISTS address_zip VARCHAR(12),
    ADD COLUMN IF NOT EXISTS birth_date DATE,
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- ---------------------------------------------------------------------------
-- Modelo de contrato versionado. O texto é conteúdo jurídico: quem manda nele
-- é o escritório, e mudar cláusula não pode exigir deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    /* Corpo com marcadores {{chave}}, preenchidos na emissão. */
    body TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_one_active
    ON contract_templates ((true)) WHERE active = true;

-- ---------------------------------------------------------------------------
-- Contrato emitido. O texto é congelado na emissão: mudar o modelo depois não
-- pode alterar o que alguém já assinou.
-- ---------------------------------------------------------------------------
CREATE TYPE contract_status AS ENUM ('DRAFT', 'AWAITING_SIGNATURE', 'SIGNED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES contract_templates(id),
    template_version VARCHAR(32) NOT NULL,
    status contract_status NOT NULL DEFAULT 'AWAITING_SIGNATURE',
    /* Texto final, já com os valores substituídos. */
    body TEXT NOT NULL,
    variables JSONB NOT NULL DEFAULT '{}',
    /* SHA-256 do corpo: prova que o texto exibido é o texto assinado. */
    body_hash CHAR(64) NOT NULL,
    signer_name VARCHAR(160),
    signer_cpf VARCHAR(20),
    signer_ip INET,
    signer_user_agent VARCHAR(400),
    signed_at TIMESTAMPTZ,
    /* Hash do aceite: corpo + assinante + instante. */
    signature_hash CHAR(64),
    /* Preenchido quando o PDF for espelhado em armazenamento externo. */
    external_url TEXT,
    external_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT contracts_signature_complete CHECK (
        status <> 'SIGNED' OR (
            signer_name IS NOT NULL AND signed_at IS NOT NULL AND signature_hash IS NOT NULL
        )
    )
);
-- Uma reserva tem no máximo um contrato vivo.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_one_live_per_reservation
    ON contracts (reservation_id) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Pagamento: vencimento (para derivar "em atraso"), método e parcelas.
-- ---------------------------------------------------------------------------
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS method VARCHAR(24) NOT NULL DEFAULT 'PIX',
    ADD COLUMN IF NOT EXISTS installments SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'DEPOSIT',
    ADD COLUMN IF NOT EXISTS checkout_url TEXT,
    ADD COLUMN IF NOT EXISTS provider_status VARCHAR(40),
    ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(200);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_valid;
ALTER TABLE payments ADD CONSTRAINT payments_method_valid
    CHECK (method IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'TRANSFER'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_valid;
ALTER TABLE payments ADD CONSTRAINT payments_kind_valid
    CHECK (kind IN ('DEPOSIT', 'BALANCE', 'FULL', 'EXTRA'));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_installments_valid;
ALTER TABLE payments ADD CONSTRAINT payments_installments_valid
    CHECK (installments BETWEEN 1 AND 24);

CREATE INDEX IF NOT EXISTS payments_due_idx ON payments (due_date)
    WHERE status IN ('PENDING', 'PROCESSING');

-- Havia índice único para UMA cobrança pendente por reserva. Com entrada e
-- saldo o modelo passa a ser duas, então a unicidade vai para (reserva, tipo).
DROP INDEX IF EXISTS payments_one_pending_per_reservation;
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_kind
    ON payments (reservation_id, kind)
    WHERE status IN ('PENDING', 'PROCESSING');

-- ---------------------------------------------------------------------------
-- Agenda: observações operacionais da reserva (chegada, chaves, pedidos).
-- ---------------------------------------------------------------------------
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS staff_notes TEXT,
    ADD COLUMN IF NOT EXISTS guest_request TEXT,
    ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'SITE';

-- ---------------------------------------------------------------------------
-- CRM. Um funil enxuto: cada contato vira um card com estágio, dono e
-- próximo passo com data. Sem próxima ação com data, CRM vira lista morta.
-- ---------------------------------------------------------------------------
CREATE TYPE crm_stage AS ENUM (
    'NEW', 'CONTACTED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST'
);

CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /* Vinculado a um usuário quando já existe cadastro; solto quando é contato frio. */
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(320),
    phone VARCHAR(32),
    stage crm_stage NOT NULL DEFAULT 'NEW',
    source VARCHAR(40) NOT NULL DEFAULT 'SITE',
    estimated_amount NUMERIC(12,2),
    check_in DATE,
    check_out DATE,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    next_action VARCHAR(200),
    next_action_at TIMESTAMPTZ,
    lost_reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS crm_leads_stage_idx ON crm_leads (stage, next_action_at NULLS LAST);
CREATE INDEX IF NOT EXISTS crm_leads_customer_idx ON crm_leads (customer_id);
-- Uma reserva não deve gerar dois cards.
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_reservation_unique
    ON crm_leads (reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(32) NOT NULL,
    body TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_activities_lead_idx ON crm_activities (lead_id, created_at DESC);
