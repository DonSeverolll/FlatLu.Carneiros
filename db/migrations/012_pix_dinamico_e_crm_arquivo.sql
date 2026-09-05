-- Pix dinâmico e arquivamento de cards do CRM.

-- ---------------------------------------------------------------------------
-- Pix com QR do provedor
-- ---------------------------------------------------------------------------
--
-- O copia-e-cola de um Pix dinâmico é emitido pelo provedor e vale só até o
-- vencimento. Guardar aqui evita pedir o mesmo QR à API a cada vez que o
-- hóspede reabre a página de pagamento — e deixa explícito quando ele venceu.
--
-- `checkout_url` continua sendo do cartão: são coisas diferentes e misturá-las
-- na mesma coluna faria a tela ter de adivinhar qual é qual.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_payload TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_qr_base64 TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_expires_at TIMESTAMPTZ;

-- A conciliação procura cobranças em aberto que já têm id no provedor.
CREATE INDEX IF NOT EXISTS payments_reconcile_idx
    ON payments (status, provider)
    WHERE status IN ('PENDING', 'PROCESSING') AND provider_transaction_id IS NOT NULL;

-- O webhook chega com o id do provedor e precisa achar a cobrança por ele.
CREATE INDEX IF NOT EXISTS payments_provider_txn_idx
    ON payments (provider, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Cards encerrados saem do quadro
-- ---------------------------------------------------------------------------
--
-- Fechado e Perdido acumulam para sempre e afogam o funil — hoje são 29 cards
-- perdidos contra 1 ganho. Arquivar tira do quadro sem apagar: o histórico do
-- lead continua consultável e o card volta sozinho se a oportunidade
-- reabrir (ver `syncLeadFromReservation`).
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);

-- O quadro lê sempre os não arquivados; o índice parcial cobre exatamente ele.
CREATE INDEX IF NOT EXISTS crm_leads_ativos_idx
    ON crm_leads (stage, next_action_at)
    WHERE archived_at IS NULL;
