-- 007_nightly_inventory.sql
-- Troca o estoque de intervalo de relógio para intervalo de NOITES.
--
-- Por que: o bloqueio era um TSTZRANGE de `check_in_time` do dia de entrada até
-- `check_out_time` do dia de saída mais a faxina. Isso só funciona enquanto essa
-- janela couber em 24 horas por noite. Com check-in às 09:00 e check-out às
-- 16:00 ela passou a medir 35 horas, e cada estadia invadia as noites vizinhas
-- dos dois lados: uma reserva de 3 noites tirava 5 do calendário.
--
-- A geometria certa é a que toda plataforma de reserva usa: o estoque é
-- nightly. Uma estadia de 04 a 07 ocupa as noites 04, 05 e 06 — o dia 07 é da
-- saída e continua vendável. Horário de chegada e de saída voltam a ser o que
-- são: informação contratual, não geometria de disponibilidade.
--
-- Quem precisar de um dia de folga entre hóspedes agora usa
-- `cleaning_gap_days`, que estende o bloqueio em dias inteiros — a unidade em
-- que o estoque realmente é contado.

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS cleaning_gap_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_gap_days_valid;
ALTER TABLE properties ADD CONSTRAINT properties_gap_days_valid
    CHECK (cleaning_gap_days BETWEEN 0 AND 7);

COMMENT ON COLUMN properties.cleaning_gap_hours IS
    'Obsoleto desde 007: o estoque é contado por noite. Use cleaning_gap_days.';

-- ---------------------------------------------------------------------------
-- Nova coluna, preenchida a partir do que já existe
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_blocks
    ADD COLUMN IF NOT EXISTS blocked_nights DATERANGE;

-- Bloqueios de reserva: as datas civis são a fonte da verdade.
UPDATE inventory_blocks b
SET blocked_nights = daterange(r.check_in, r.check_out + p.cleaning_gap_days, '[)')
FROM reservations r, properties p
WHERE b.reservation_id = r.id
  AND p.id = b.property_id
  AND b.blocked_nights IS NULL;

-- Bloqueios manuais (manutenção, uso do proprietário): converte o intervalo de
-- relógio para datas civis no fuso da propriedade.
UPDATE inventory_blocks b
SET blocked_nights = daterange(
        (lower(b.blocked_period) AT TIME ZONE p.timezone)::date,
        (upper(b.blocked_period) AT TIME ZONE p.timezone)::date,
        '[)'
    )
FROM properties p
WHERE p.id = b.property_id
  AND b.reservation_id IS NULL
  AND b.blocked_nights IS NULL;

-- Um intervalo vazio não bloqueia nada e passaria pela constraint sem barulho.
UPDATE inventory_blocks
SET blocked_nights = daterange(lower(blocked_nights), lower(blocked_nights) + 1, '[)')
WHERE blocked_nights IS NOT NULL AND isempty(blocked_nights);

DELETE FROM inventory_blocks WHERE blocked_nights IS NULL;

ALTER TABLE inventory_blocks ALTER COLUMN blocked_nights SET NOT NULL;

ALTER TABLE inventory_blocks DROP CONSTRAINT IF EXISTS inventory_blocks_nights_not_empty;
ALTER TABLE inventory_blocks ADD CONSTRAINT inventory_blocks_nights_not_empty
    CHECK (NOT isempty(blocked_nights));

-- ---------------------------------------------------------------------------
-- A garantia anti-overbooking passa a valer sobre as noites. Continua sendo o
-- banco quem recusa a sobreposição, não a aplicação.
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_blocks DROP CONSTRAINT IF EXISTS inventory_blocks_no_overlap;
ALTER TABLE inventory_blocks ADD CONSTRAINT inventory_blocks_no_overlap EXCLUDE USING gist (
    property_id WITH =,
    blocked_nights WITH &&
) WHERE (active = true);

ALTER TABLE inventory_blocks DROP COLUMN IF EXISTS blocked_period;

CREATE INDEX IF NOT EXISTS inventory_blocks_nights_idx
    ON inventory_blocks USING gist (blocked_nights) WHERE active = true;
