-- 014_meta_e_atendimento.sql
-- Atribuição de marketing (UTM, fbclid, anúncio da Meta), métricas de
-- anúncios e a Central de Atendimento (WhatsApp + Instagram Direct).
--
-- Sobre o nome das tabelas de atendimento: `conversas_whatsapp` e
-- `mensagens_whatsapp` guardam também o Instagram Direct (coluna `canal`). O
-- inbox é um só de propósito — o atendente não deveria ter de saber por qual
-- app o hóspede escreveu para responder.

-- ---------------------------------------------------------------------------
-- Chave de telefone
-- ---------------------------------------------------------------------------
--
-- O WhatsApp entrega o número brasileiro de celular às vezes SEM o nono
-- dígito (`55 81 8765-4321` em vez de `55 81 98765-4321`), conforme a idade da
-- conta. Comparar o número inteiro faria o mesmo hóspede virar dois leads. A
-- chave é DDI + DDD + os últimos 8 dígitos, que são iguais nos dois formatos.
-- Número sem DDI recebe 55: o cadastro do site pede o telefone sem ele.
CREATE OR REPLACE FUNCTION telefone_chave(numero TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    WITH d AS (SELECT regexp_replace(COALESCE(numero, ''), '\D', '', 'g') AS n),
         c AS (
             SELECT CASE
                 WHEN length(n) IN (10, 11) THEN '55' || n
                 ELSE n
             END AS n FROM d
         )
    SELECT CASE
        WHEN n = '' THEN NULL
        WHEN n LIKE '55%' AND length(n) IN (12, 13)
            THEN '55' || substr(n, 3, 2) || right(n, 8)
        ELSE n
    END
    FROM c
$$;

CREATE INDEX IF NOT EXISTS users_telefone_chave_idx ON users (telefone_chave(phone))
    WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_telefone_chave_idx ON crm_leads (telefone_chave(phone))
    WHERE phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pontos de contato (touches)
-- ---------------------------------------------------------------------------
--
-- Cada chegada ao site com parâmetro de campanha vira uma linha. O lead
-- guarda o primeiro e o último toque; a tabela guarda todos, para quem quiser
-- depois comparar atribuição de primeiro e de último clique.
--
-- Não guardamos IP nem user-agent: atribuição não precisa deles, e dado que
-- não existe não vaza.
CREATE TABLE IF NOT EXISTS marketing_touches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    /* Cookie de primeira parte `mkt_vid`, gerado pelo servidor. */
    visitor_id UUID NOT NULL,
    /* Preenchido no cadastro, quando o visitante vira usuário. */
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    origem_canal VARCHAR(32) NOT NULL,
    utm_source VARCHAR(200),
    utm_medium VARCHAR(200),
    utm_campaign VARCHAR(200),
    utm_content VARCHAR(200),
    utm_term VARCHAR(200),
    fbclid VARCHAR(500),
    gclid VARCHAR(500),
    /* IDs da Meta são numéricos; texto porque passam de 2^53. */
    ad_id VARCHAR(32),
    adset_id VARCHAR(32),
    campaign_id VARCHAR(32),
    landing_path VARCHAR(500),
    referrer_host VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_touches_visitor_idx
    ON marketing_touches (visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_touches_user_idx
    ON marketing_touches (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_touches_ad_idx
    ON marketing_touches (ad_id) WHERE ad_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Lead com origem
-- ---------------------------------------------------------------------------
--
-- `crm_leads` é a tabela de leads do sistema: o CRM já a alimenta sozinho a
-- partir das reservas. Uma tabela `leads` paralela partiria o funil em dois.
--
-- `source` (já existente) diz por onde o card ENTROU no sistema (SITE,
-- MANUAL, WHATSAPP...). `origem_canal` diz de onde a PESSOA veio — um lead que
-- reservou pelo site pode ter vindo de um anúncio do Instagram.
ALTER TABLE crm_leads
    ADD COLUMN IF NOT EXISTS origem_canal VARCHAR(32),
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200),
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200),
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200),
    ADD COLUMN IF NOT EXISTS utm_content VARCHAR(200),
    ADD COLUMN IF NOT EXISTS utm_term VARCHAR(200),
    ADD COLUMN IF NOT EXISTS fbclid VARCHAR(500),
    ADD COLUMN IF NOT EXISTS ad_id VARCHAR(32),
    ADD COLUMN IF NOT EXISTS adset_id VARCHAR(32),
    ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(32),
    /* Click-to-WhatsApp: identificador do clique, exigido pela API de conversões. */
    ADD COLUMN IF NOT EXISTS ctwa_clid VARCHAR(500),
    ADD COLUMN IF NOT EXISTS first_touch_id UUID REFERENCES marketing_touches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_touch_id UUID REFERENCES marketing_touches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS atribuido_em TIMESTAMPTZ;

ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_origem_canal_valida;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_origem_canal_valida CHECK (
    origem_canal IS NULL OR origem_canal IN (
        'META_ADS', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'GOOGLE_ADS', 'GOOGLE',
        'SITE', 'INDICACAO', 'MANUAL', 'OUTRO'
    )
);
ALTER TABLE marketing_touches DROP CONSTRAINT IF EXISTS marketing_touches_origem_canal_valida;
ALTER TABLE marketing_touches ADD CONSTRAINT marketing_touches_origem_canal_valida CHECK (
    origem_canal IN (
        'META_ADS', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'GOOGLE_ADS', 'GOOGLE',
        'SITE', 'INDICACAO', 'MANUAL', 'OUTRO'
    )
);

CREATE INDEX IF NOT EXISTS crm_leads_ad_idx ON crm_leads (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_origem_idx ON crm_leads (origem_canal, created_at DESC);

-- ---------------------------------------------------------------------------
-- Anúncios da Meta e métricas diárias
-- ---------------------------------------------------------------------------
--
-- Sem FK de `crm_leads.ad_id` para cá: o lead chega com o ad_id antes da
-- primeira sincronização, e recusá-lo por isso perderia a atribuição.
CREATE TABLE IF NOT EXISTS meta_ads (
    ad_id VARCHAR(32) PRIMARY KEY,
    ad_name VARCHAR(400),
    adset_id VARCHAR(32),
    adset_name VARCHAR(400),
    campaign_id VARCHAR(32),
    campaign_name VARCHAR(400),
    account_id VARCHAR(40),
    effective_status VARCHAR(40),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_ads_campaign_idx ON meta_ads (campaign_id);

CREATE TABLE IF NOT EXISTS meta_ad_insights (
    ad_id VARCHAR(32) NOT NULL REFERENCES meta_ads(ad_id) ON DELETE CASCADE,
    dia DATE NOT NULL,
    spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
    impressions BIGINT NOT NULL DEFAULT 0,
    clicks BIGINT NOT NULL DEFAULT 0,
    link_clicks BIGINT NOT NULL DEFAULT 0,
    /* O que a Meta diz ter convertido. A verdade sobre reserva é o nosso banco. */
    leads_meta INTEGER NOT NULL DEFAULT 0,
    conversas_iniciadas INTEGER NOT NULL DEFAULT 0,
    actions JSONB NOT NULL DEFAULT '[]',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ad_id, dia)
);
CREATE INDEX IF NOT EXISTS meta_ad_insights_dia_idx ON meta_ad_insights (dia);

CREATE TABLE IF NOT EXISTS meta_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo VARCHAR(32) NOT NULL,
    iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em TIMESTAMPTZ,
    ok BOOLEAN,
    detalhe JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS meta_sync_runs_tipo_idx ON meta_sync_runs (tipo, iniciado_em DESC);

-- ---------------------------------------------------------------------------
-- Central de Atendimento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversas_whatsapp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canal VARCHAR(16) NOT NULL DEFAULT 'WHATSAPP',
    /* wa_id (WhatsApp) ou IGSID (Instagram): quem identifica o contato no canal. */
    contato_externo_id VARCHAR(64) NOT NULL,
    contato_nome VARCHAR(160),
    contato_telefone VARCHAR(32),
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    reserva_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ABERTA',
    responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL,
    nao_lidas INTEGER NOT NULL DEFAULT 0,
    ultima_mensagem_em TIMESTAMPTZ,
    ultima_mensagem_previa VARCHAR(200),
    /*
     * Janela de atendimento: o WhatsApp só aceita texto livre até 24h depois
     * da última mensagem do cliente. Fora dela, só modelo aprovado. Guardar o
     * prazo deixa a tela avisar ANTES de o atendente escrever.
     */
    janela_expira_em TIMESTAMPTZ,
    /* Anúncio de origem quando a conversa nasceu de click-to-WhatsApp/Direct. */
    referral JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversas_canal_valido CHECK (canal IN ('WHATSAPP', 'INSTAGRAM')),
    CONSTRAINT conversas_status_valido CHECK (status IN ('ABERTA', 'PENDENTE', 'RESOLVIDA')),
    CONSTRAINT conversas_nao_lidas_nao_negativo CHECK (nao_lidas >= 0),
    CONSTRAINT conversas_contato_unico UNIQUE (canal, contato_externo_id)
);
CREATE INDEX IF NOT EXISTS conversas_fila_idx
    ON conversas_whatsapp (status, ultima_mensagem_em DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversas_lead_idx ON conversas_whatsapp (lead_id);
CREATE INDEX IF NOT EXISTS conversas_reserva_idx ON conversas_whatsapp (reserva_id);

CREATE TABLE IF NOT EXISTS mensagens_whatsapp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id UUID NOT NULL REFERENCES conversas_whatsapp(id) ON DELETE CASCADE,
    /* Copiados da conversa no momento da mensagem: o histórico do lead não
       muda se a conversa for revinculada depois. */
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    reserva_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    canal VARCHAR(16) NOT NULL,
    direcao VARCHAR(8) NOT NULL,
    tipo VARCHAR(16) NOT NULL DEFAULT 'TEXTO',
    /* Texto, ou legenda quando há mídia. */
    corpo TEXT,
    midia_url TEXT,
    midia_id_provedor VARCHAR(160),
    midia_mime VARCHAR(120),
    midia_nome_arquivo VARCHAR(240),
    status VARCHAR(12) NOT NULL,
    erro VARCHAR(500),
    /* wamid / mid. Único por canal: é ele que torna o webhook idempotente. */
    id_externo VARCHAR(200),
    autor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    /* Instante informado pelo provedor; created_at é quando gravamos. */
    enviada_em TIMESTAMPTZ,
    entregue_em TIMESTAMPTZ,
    lida_em TIMESTAMPTZ,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mensagens_canal_valido CHECK (canal IN ('WHATSAPP', 'INSTAGRAM')),
    CONSTRAINT mensagens_direcao_valida CHECK (direcao IN ('ENTRADA', 'SAIDA')),
    CONSTRAINT mensagens_tipo_valido CHECK (
        tipo IN ('TEXTO', 'IMAGEM', 'PDF', 'VIDEO', 'AUDIO', 'DOCUMENTO', 'TEMPLATE', 'OUTRO')
    ),
    CONSTRAINT mensagens_status_valido CHECK (
        status IN ('PENDENTE', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU', 'RECEBIDA')
    ),
    CONSTRAINT mensagens_conteudo CHECK (
        corpo IS NOT NULL OR midia_url IS NOT NULL OR midia_id_provedor IS NOT NULL
        OR tipo IN ('TEMPLATE', 'OUTRO')
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS mensagens_id_externo_unico
    ON mensagens_whatsapp (canal, id_externo) WHERE id_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS mensagens_conversa_idx
    ON mensagens_whatsapp (conversa_id, created_at DESC);
-- A tela faz polling por "o que mudou desde X" (mensagem nova OU status novo).
CREATE INDEX IF NOT EXISTS mensagens_conversa_atualizadas_idx
    ON mensagens_whatsapp (conversa_id, updated_at);
CREATE INDEX IF NOT EXISTS mensagens_lead_idx ON mensagens_whatsapp (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mensagens_reserva_idx ON mensagens_whatsapp (reserva_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- A aplicação conecta como DONA das tabelas (usuário `postgres` no pooler do
-- Supabase, `app` no Docker). Dono de tabela não é filtrado por RLS, então as
-- políticas abaixo não mudam nada para o Next.js — quem autoriza o painel é
-- `requireAdmin()` em cada rota.
--
-- O que a RLS protege é a OUTRA porta: a Data API do Supabase (PostgREST),
-- que expõe o schema `public` a quem tiver a chave `anon`, e essa chave é
-- pública por definição. Sem RLS, conversa de hóspede seria legível por ela.
--
-- O papel `authenticated` NÃO é liberado por padrão. Este sistema não usa o
-- Supabase Auth; qualquer pessoa que criasse conta lá viraria `authenticated`
-- e leria o atendimento. A política só deixa passar um `auth.uid()` que seja
-- administrador ATIVO na tabela `users` — vale se um dia o painel passar a
-- usar o Supabase Auth com o mesmo UUID; até lá, não casa com ninguém.
ALTER TABLE marketing_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ad_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversas_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens_whatsapp ENABLE ROW LEVEL SECURITY;

-- Políticas só onde existem os papéis e o schema `auth` do Supabase. No
-- Postgres do Docker local esses objetos não existem e a migração seguiria
-- quebrando se os referenciasse diretamente.
DO $$
DECLARE
    tabela TEXT;
BEGIN
    IF to_regnamespace('auth') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        RAISE NOTICE 'Sem Supabase Auth neste banco: RLS ligada, nenhuma política criada.';
        RETURN;
    END IF;

    EXECUTE $f$
        CREATE OR REPLACE FUNCTION public.painel_admin_ativo() RETURNS BOOLEAN
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.users
                 WHERE id = auth.uid() AND role = 'ADMIN' AND status = 'ACTIVE'
                   AND deleted_at IS NULL
            )
        $body$
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.painel_admin_ativo() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.painel_admin_ativo() TO authenticated';

    FOREACH tabela IN ARRAY ARRAY[
        'marketing_touches', 'meta_ads', 'meta_ad_insights', 'meta_sync_runs',
        'conversas_whatsapp', 'mensagens_whatsapp'
    ] LOOP
        -- `anon` não tem o que fazer aqui: nem ler, nem escrever.
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', tabela);
        EXECUTE format('DROP POLICY IF EXISTS admin_le ON public.%I', tabela);
        EXECUTE format(
            'CREATE POLICY admin_le ON public.%I FOR SELECT TO authenticated
               USING (public.painel_admin_ativo())', tabela);
    END LOOP;

    -- Responder e reatribuir conversa: só admin ativo.
    DROP POLICY IF EXISTS admin_responde ON public.mensagens_whatsapp;
    CREATE POLICY admin_responde ON public.mensagens_whatsapp
        FOR INSERT TO authenticated
        WITH CHECK (public.painel_admin_ativo() AND direcao = 'SAIDA');

    DROP POLICY IF EXISTS admin_atualiza ON public.conversas_whatsapp;
    CREATE POLICY admin_atualiza ON public.conversas_whatsapp
        FOR UPDATE TO authenticated
        USING (public.painel_admin_ativo())
        WITH CHECK (public.painel_admin_ativo());
END $$;
