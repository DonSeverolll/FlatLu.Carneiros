-- Locação de um dia só, com entrega no mesmo dia (uso diurno).
--
-- Até aqui o modelo só sabia vender NOITES: `check_out` igual a `check_in`
-- dava zero noites e a reserva era recusada como intervalo inválido. Quem
-- quisesse usar o espaço das 09:00 às 16:00 do mesmo dia não tinha caminho.
--
-- A partir daqui `check_in = check_out` é uma estadia legítima. Ela ocupa
-- apenas AQUELE dia no calendário — os demais continuam vendáveis, que é o
-- ponto de existir a modalidade.

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS day_use_allowed BOOLEAN NOT NULL DEFAULT true;

/*
 * Tarifa própria do uso diurno.
 *
 * Nula significa "cobra a diária normal daquele dia" — a tabela por dia da
 * semana e os períodos especiais continuam valendo. Não inventamos desconto:
 * quem decide se um dia sem pernoite custa menos é a proprietária, e enquanto
 * ela não disser nada o preço é o mesmo da diária.
 */
ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS day_use_amount NUMERIC(12, 2);

ALTER TABLE properties
    ADD CONSTRAINT properties_day_use_amount_nonneg
    CHECK (day_use_amount IS NULL OR day_use_amount >= 0);

/*
 * A reserva deixa de exigir saída depois da entrada.
 *
 * Se houver um CHECK antigo com `check_out > check_in`, ele passa a recusar o
 * uso diurno. O nome varia conforme quando a tabela foi criada, então a troca
 * é feita procurando a restrição pela definição.
 */
DO $$
DECLARE
    nome text;
BEGIN
    FOR nome IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'reservations'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%check_out%>%check_in%'
    LOOP
        EXECUTE format('ALTER TABLE reservations DROP CONSTRAINT %I', nome);
    END LOOP;
END $$;

ALTER TABLE reservations
    ADD CONSTRAINT reservations_saida_nao_antecede_entrada
    CHECK (check_out >= check_in);
