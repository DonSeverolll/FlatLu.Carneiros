-- 008_payment_status_values.sql
-- Novos estados de pagamento, para acompanhar o ciclo de um provedor de
-- cartão/Pix além do que existia (PENDING, PARTIAL, PAID, REFUNDED, FAILED):
--
--   PROCESSING  autorizado, aguardando compensação
--   DECLINED    recusado pelo emissor
--   CANCELLED   cancelado antes de compensar
--
-- "Em atraso" NÃO é um valor aqui de propósito: é PENDING cujo `due_date` já
-- passou. Guardar isso como estado exigiria um processo varrendo a tabela para
-- mantê-lo verdadeiro, e ele ficaria errado no intervalo entre varreduras. É
-- derivado na leitura, onde não tem como divergir.
--
-- Arquivo separado porque `ALTER TYPE ... ADD VALUE` não permite usar o valor
-- novo na mesma transação que o criou.

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'CANCELLED';
