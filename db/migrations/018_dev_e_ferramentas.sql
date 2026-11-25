-- 018_dev_e_ferramentas.sql
-- Acesso por ferramenta no painel.
--
-- `is_dev` marca a conta de quem desenvolve o site: ela vê tudo e é a única que
-- libera ou bloqueia ferramentas para os outros administradores (os donos).
-- `ferramentas` diz o que cada administrador pode abrir — vale tanto para a
-- página quanto para a API correspondente.
--
-- Quem vira Dev não está aqui: é definido direto no banco, na conta certa,
-- depois desta migration (não queremos e-mail de ninguém versionado).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_dev BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ferramentas TEXT[] NOT NULL DEFAULT '{}';

-- Uma conta Dev só.
CREATE UNIQUE INDEX IF NOT EXISTS users_uma_conta_dev ON users ((true)) WHERE is_dev;

-- Ninguém perde acesso no dia da troca: os administradores de hoje começam com
-- todas as ferramentas. Daqui em diante, quem libera ou tira é o Dev.
UPDATE users
   SET ferramentas = ARRAY['menu','dashboard','atendimento','crm','marketing','catalogo',
                           'seo','clientes','agenda','usuarios','log','configuracoes']
 WHERE role = 'ADMIN' AND deleted_at IS NULL AND ferramentas = '{}';
