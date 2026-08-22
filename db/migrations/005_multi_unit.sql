-- 005_multi_unit.sql
-- O negócio tem três espaços independentes, não um:
--   Flat Carneiros      (Praia de Carneiros)  até  7 pessoas
--   Casa Térreo         (São José)            até 10 pessoas
--   Casa 1º Andar       (São José)            até 10 pessoas
--
-- São locais distintos: alugar um NÃO ocupa outro. Isso significa que a
-- constraint de exclusão existente já está correta como está — ela é chaveada
-- por `property_id`, então cada unidade tem seu próprio calendário e o banco
-- continua impedindo overbooking dentro de cada uma.
--
-- O que falta é metadado de apresentação (cor, ordem, localização) e as duas
-- unidades novas com suas tarifas.

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS short_name VARCHAR(60),
    /* Cor da unidade no calendário. Hex de 7 caracteres (#RRGGBB). */
    ADD COLUMN IF NOT EXISTS color VARCHAR(7),
    ADD COLUMN IF NOT EXISTS location_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS location_url TEXT,
    ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 100;

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_color_hex;
ALTER TABLE properties ADD CONSTRAINT properties_color_hex
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');

CREATE INDEX IF NOT EXISTS properties_active_order_idx
    ON properties (display_order, name) WHERE active = true;

-- ---------------------------------------------------------------------------
-- Unidade já existente: passa a ser uma das três.
-- ---------------------------------------------------------------------------
UPDATE properties SET
    short_name = 'Flat Carneiros',
    color = '#1F3A5F',
    location_name = 'Praia de Carneiros, Tamandaré — PE',
    location_url = 'https://maps.app.goo.gl/UzYywAAcEzB21pYQ6',
    display_order = 10,
    max_guests = 7,
    min_nights = 1
WHERE slug = 'flat-praia-de-carneiros';

-- ---------------------------------------------------------------------------
-- Casa em São José: dois andares vendidos separadamente.
--
-- `nightly_rate` fica em 0 de propósito: é apenas fallback para dias sem
-- tarifa própria, e o preço real vive em `rate_weekdays`. Assim, se alguém
-- apagar a tarifa de um dia, a vitrine diz "sob consulta" em vez de inventar
-- um valor.
-- ---------------------------------------------------------------------------
INSERT INTO properties (
    name, slug, short_name, description, nightly_rate, terms_version, terms_content,
    color, location_name, location_url, display_order,
    max_guests, min_nights, deposit_percentage, timezone, hold_minutes
)
VALUES
(
    'Casa Térreo — São José',
    'casa-sao-jose-terreo',
    'Casa Térreo',
    'Andar térreo da casa em São José da Coroa Grande, com acesso independente. Acomoda até 10 pessoas.',
    0, 'v1', 'Termos de locação pendentes de publicação.',
    '#2E6F4E',
    'São José da Coroa Grande — PE',
    'https://maps.app.goo.gl/8AZpiH9GR2nD9RhF6',
    20, 10, 1, 50.00, 'America/Recife', 30
),
(
    'Casa 1º Andar — São José',
    'casa-sao-jose-primeiro-andar',
    'Casa 1º Andar',
    'Primeiro andar da casa em São José da Coroa Grande, com acesso independente. Acomoda até 10 pessoas.',
    0, 'v1', 'Termos de locação pendentes de publicação.',
    '#E76F51',
    'São José da Coroa Grande — PE',
    'https://maps.app.goo.gl/8AZpiH9GR2nD9RhF6',
    30, 10, 1, 50.00, 'America/Recife', 30
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tarifas por dia da semana (0 = domingo, 6 = sábado).
--
--                    Diária comum   Sexta    Fim de semana (sábado)
--   Flat                  R$ 300    R$ 400          R$ 1.000
--   Cada andar            R$ 700    R$ 900          R$ 1.900
--
-- Natal e Réveillon entram como períodos com data em /admin — dependem do
-- calendário de cada ano.
-- ---------------------------------------------------------------------------
INSERT INTO rate_weekdays (property_id, weekday, nightly_amount)
SELECT p.id, d.weekday, d.amount
FROM properties p
CROSS JOIN (VALUES
    (0, 700.00), (1, 700.00), (2, 700.00), (3, 700.00), (4, 700.00),
    (5, 900.00), (6, 1900.00)
) AS d(weekday, amount)
WHERE p.slug IN ('casa-sao-jose-terreo', 'casa-sao-jose-primeiro-andar')
ON CONFLICT (property_id, weekday) DO NOTHING;
