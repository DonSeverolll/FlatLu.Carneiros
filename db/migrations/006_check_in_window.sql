-- 006_check_in_window.sql
-- Horários contratuais dos três espaços:
--   check-in  a partir das 09:00, até as 16:00
--   check-out impreterivelmente até as 16:00
--
-- ATENÇÃO — consequência de estoque, deliberada:
--
-- As duas janelas se sobrepõem no mesmo dia. O bloqueio de uma estadia vai de
-- `check_in_time` do dia de entrada até `check_out_time` do dia de saída, então
-- uma estadia que termina no dia D ocupa D das 00:00 às 16:00 — e uma estadia
-- que começa em D reivindica D a partir das 09:00. Elas colidem, e a constraint
-- de exclusão recusa.
--
-- Ou seja: NÃO existe virada no mesmo dia. Uma estadia de N noites tira N+1
-- noites do calendário (a noite da saída também). Isso é o retrato fiel de um
-- check-out às 16:00 com check-in às 09:00 — não há intervalo para limpeza
-- entre um hóspede e o próximo no mesmo dia.
--
-- Para permitir virada no mesmo dia, o check-in precisa começar depois do
-- check-out (por exemplo check_in_time = '17:00'), ou o check-out precisa ser
-- de manhã (por exemplo '11:00', que era o valor anterior).

ALTER TABLE properties
    /* Fim da janela de chegada. Informativo para o hóspede: o estoque é
       calculado por `check_in_time`, que é quando a ocupação começa. */
    ADD COLUMN IF NOT EXISTS check_in_until TIME NOT NULL DEFAULT '16:00';

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_check_in_window;
ALTER TABLE properties ADD CONSTRAINT properties_check_in_window
    CHECK (check_in_until >= check_in_time);

UPDATE properties SET
    check_in_time  = '09:00',
    check_in_until = '16:00',
    check_out_time = '16:00',
    updated_at = now()
WHERE active = true;
