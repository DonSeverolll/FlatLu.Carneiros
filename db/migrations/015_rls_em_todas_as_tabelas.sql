-- 015_rls_em_todas_as_tabelas.sql
-- Row Level Security em TODAS as tabelas do schema public.
--
-- Até aqui só as tabelas da 014 tinham RLS. No Supabase, a Data API
-- (PostgREST) expõe o schema `public` a quem tiver a chave `anon` — que é
-- pública por definição — e o Supabase concede SELECT/INSERT/UPDATE/DELETE a
-- `anon` e `authenticated` em toda tabela nova. Sem RLS, isso deixava legíveis
-- pela internet: `users` (com hash de senha), `user_sessions` (hash do refresh
-- token), `landlords` (CPF e RG da locadora), contratos, pagamentos.
--
-- A aplicação NÃO muda: ela conecta como DONA das tabelas (`postgres` no
-- pooler do Supabase, `app` no Docker), e o dono não é filtrado por RLS
-- enquanto a tabela não tiver FORCE ROW LEVEL SECURITY — que não usamos.
--
-- Nenhuma política é criada para as tabelas antigas: nada neste sistema usa a
-- Data API, então "ninguém por ela" é o comportamento certo. As políticas de
-- admin da 014 continuam onde estão.

DO $$
DECLARE
    t RECORD;
    supabase BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
                    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
    -- Tabelas da 014: têm política para admin via `authenticated`, então
    -- mantêm o GRANT desse papel (política sem GRANT não vale nada).
    com_politica TEXT[] := ARRAY[
        'marketing_touches', 'meta_ads', 'meta_ad_insights', 'meta_sync_runs',
        'conversas_whatsapp', 'mensagens_whatsapp'
    ];
BEGIN
    FOR t IN
        SELECT c.relname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);

        IF supabase THEN
            -- Defesa em profundidade: com RLS e sem política o acesso já é
            -- nulo; sem GRANT a Data API responde "permission denied" em vez
            -- de uma lista vazia que parece bug.
            EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.relname);
            IF NOT t.relname = ANY (com_politica) THEN
                EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.relname);
            END IF;
        END IF;
    END LOOP;

    IF supabase THEN
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
        -- Tabela criada depois por este mesmo usuário nasce sem GRANT para os
        -- papéis da Data API. A RLS dela ainda precisa ser ligada na própria
        -- migração; `npm run db:migrate` avisa quando alguma ficar sem.
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    ELSE
        RAISE NOTICE 'Sem papéis do Supabase neste banco: RLS ligada, nenhum REVOKE necessário.';
    END IF;
END $$;
