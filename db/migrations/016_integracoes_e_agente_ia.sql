-- 016_integracoes_e_agente_ia.sql
-- Integrações configuráveis pelo painel (Meta, WhatsApp, Instagram, anúncios,
-- agente de IA) e o registro do que o agente fez.

-- ---------------------------------------------------------------------------
-- Integrações
-- ---------------------------------------------------------------------------
--
-- Antes, credencial só por variável de ambiente: trocar o token do WhatsApp
-- exigia acesso ao Vercel e um novo deploy. Agora o painel grava aqui, e a
-- variável de ambiente continua valendo como alternativa (campo a campo).
--
-- `segredos` é um JSON cifrado com AES-256-GCM pela aplicação, com a chave em
-- INTEGRATIONS_ENCRYPTION_KEY — que nunca entra no banco. Um dump desta tabela
-- sozinho não revela token nenhum. O nome da integração entra como dado
-- autenticado da cifra: um segredo copiado para outra linha não decifra.
CREATE TABLE IF NOT EXISTS integracoes (
    chave VARCHAR(32) PRIMARY KEY,
    ativo BOOLEAN NOT NULL DEFAULT true,
    /* Valores não secretos: IDs, modo, modelo, instruções. */
    config JSONB NOT NULL DEFAULT '{}',
    segredos TEXT,
    /* Quais segredos estão definidos e seus 4 últimos caracteres, para a tela
       mostrar "definido (…a1b2)" sem decifrar nada. */
    segredos_resumo JSONB NOT NULL DEFAULT '{}',
    testado_em TIMESTAMPTZ,
    teste_ok BOOLEAN,
    teste_detalhe VARCHAR(500),
    atualizado_por UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT integracoes_chave_valida CHECK (
        chave IN ('META_APP', 'WHATSAPP', 'INSTAGRAM', 'META_ADS', 'AGENTE_IA')
    )
);

-- ---------------------------------------------------------------------------
-- Agente de IA no atendimento
-- ---------------------------------------------------------------------------
ALTER TABLE mensagens_whatsapp
    ADD COLUMN IF NOT EXISTS gerada_por_ia BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversas_whatsapp
    /* O atendente assumiu: o agente não responde mais sozinho nesta conversa. */
    ADD COLUMN IF NOT EXISTS ia_pausada BOOLEAN NOT NULL DEFAULT false,
    /* Respostas automáticas já dadas, para o teto por conversa. */
    ADD COLUMN IF NOT EXISTS ia_respostas INTEGER NOT NULL DEFAULT 0;

-- Cada chamada ao modelo fica registrada: custo (tokens), o que o agente
-- consultou e por que não respondeu, quando não respondeu.
CREATE TABLE IF NOT EXISTS agente_execucoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id UUID REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
    modo VARCHAR(16) NOT NULL,
    resultado VARCHAR(24) NOT NULL,
    modelo VARCHAR(60),
    input_tokens INTEGER,
    output_tokens INTEGER,
    ferramentas JSONB NOT NULL DEFAULT '[]',
    detalhe VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agente_execucoes_modo_valido CHECK (modo IN ('SUGESTAO', 'AUTOMATICO', 'TESTE')),
    CONSTRAINT agente_execucoes_resultado_valido CHECK (
        resultado IN ('RESPONDEU', 'SUGERIU', 'TRANSFERIU', 'IGNOROU', 'RECUSOU', 'ERRO')
    )
);
CREATE INDEX IF NOT EXISTS agente_execucoes_conversa_idx
    ON agente_execucoes (conversa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agente_execucoes_data_idx ON agente_execucoes (created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS (ver 015): tabela nova nasce com RLS e sem acesso pela Data API.
-- ---------------------------------------------------------------------------
ALTER TABLE integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agente_execucoes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.integracoes FROM anon, authenticated;
        REVOKE ALL ON public.agente_execucoes FROM anon, authenticated;
    END IF;
END $$;
