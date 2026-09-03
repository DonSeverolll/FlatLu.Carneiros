-- Nem todo evento aponta para uma linha do banco.
--
-- Uma tentativa de login recusada é o caso claro: não há usuário a que
-- atribuir e não há entidade alvo — o identificador digitado pode nem
-- existir. Com `entity_id` NOT NULL o INSERT falhava e o evento sumia sem
-- ruído, justamente o tipo de evento que mais importa em uma auditoria.
ALTER TABLE audit_events ALTER COLUMN entity_id DROP NOT NULL;

-- O log é sempre lido do mais recente para o mais antigo, filtrando por tipo
-- de evento e por autor. Sem estes índices a tela varre a tabela inteira a
-- cada troca de filtro.
CREATE INDEX IF NOT EXISTS audit_events_created_at_desc_idx
    ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_event_type_idx
    ON audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx
    ON audit_events (actor_user_id, created_at DESC);

-- Localiza o bloqueio pelo id gravado no metadata: é o que liga um bloqueio
-- ao motivo e a quem o criou, na Agenda.
CREATE INDEX IF NOT EXISTS audit_events_block_id_idx
    ON audit_events ((metadata->>'blockId'))
    WHERE metadata ? 'blockId';
