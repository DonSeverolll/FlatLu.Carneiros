-- 017_catalogo_instagram.sql
-- Catálogo de fotos por espaço, sincronizado do Instagram oficial pela API.

-- ---------------------------------------------------------------------------
-- Palavras que identificam cada espaço numa legenda
-- ---------------------------------------------------------------------------
--
-- A API do Instagram não informa onde a foto foi tirada. A primeira pista é
-- a legenda: "pôr do sol em Carneiros" é do flat, "área da piscina em São
-- José" é da casa. Ficam por espaço para a proprietária ajustar.
ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS catalogo_palavras TEXT[] NOT NULL DEFAULT '{}';

UPDATE properties SET catalogo_palavras = ARRAY['carneiros', 'tamandaré', 'tamandare', 'flat']
 WHERE slug = 'flat-praia-de-carneiros' AND catalogo_palavras = '{}';
UPDATE properties SET catalogo_palavras = ARRAY['térreo', 'terreo', 'piscina']
 WHERE slug = 'casa-sao-jose-terreo' AND catalogo_palavras = '{}';
UPDATE properties SET catalogo_palavras = ARRAY['1º andar', 'primeiro andar', '1o andar', 'andar de cima', 'varanda']
 WHERE slug = 'casa-sao-jose-primeiro-andar' AND catalogo_palavras = '{}';

-- ---------------------------------------------------------------------------
-- Fotos e vídeos
-- ---------------------------------------------------------------------------
--
-- Um carrossel do Instagram vira uma linha por foto (album_id aponta o post).
-- `media_url` é a URL do CDN da Meta, que EXPIRA em alguns dias: a
-- sincronização diária a renova. Não guardamos a imagem em si — o site não
-- tem armazenamento de arquivos, e a Meta permite exibir a mídia da própria
-- conta pela URL que a API entrega.
CREATE TABLE IF NOT EXISTS catalogo_midias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ig_media_id VARCHAR(40) NOT NULL UNIQUE,
    album_id VARCHAR(40),
    tipo VARCHAR(16) NOT NULL,
    media_url TEXT,
    thumbnail_url TEXT,
    permalink TEXT,
    legenda TEXT,
    publicado_em TIMESTAMPTZ,
    /* Espaço confirmado por um administrador. Só aparece no site com ele. */
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    /* Sugestão automática, que o administrador aceita ou troca. */
    sugestao_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    sugestao_origem VARCHAR(16),
    sugestao_motivo VARCHAR(300),
    visivel BOOLEAN NOT NULL DEFAULT true,
    capa BOOLEAN NOT NULL DEFAULT false,
    ordem INTEGER NOT NULL DEFAULT 0,
    /* Texto alternativo para leitores de tela (sugerido pela IA ou digitado). */
    descricao VARCHAR(300),
    /* Sumiu do Instagram (post apagado/arquivado): sai do site, fica o registro. */
    removida_em TIMESTAMPTZ,
    sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT catalogo_tipo_valido CHECK (tipo IN ('IMAGE', 'VIDEO')),
    CONSTRAINT catalogo_sugestao_valida CHECK (sugestao_origem IS NULL OR sugestao_origem IN ('LEGENDA', 'IA'))
);
CREATE INDEX IF NOT EXISTS catalogo_publico_idx
    ON catalogo_midias (property_id, capa DESC, ordem, publicado_em DESC)
    WHERE visivel AND removida_em IS NULL AND property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalogo_album_idx ON catalogo_midias (album_id);

-- Uma capa por espaço.
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_uma_capa_por_espaco
    ON catalogo_midias (property_id) WHERE capa AND property_id IS NOT NULL;

ALTER TABLE catalogo_midias ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.catalogo_midias FROM anon, authenticated;
    END IF;
END $$;

-- O modo TESTE de agente_execucoes passa a cobrir a classificação de fotos.
ALTER TABLE agente_execucoes DROP CONSTRAINT IF EXISTS agente_execucoes_modo_valido;
ALTER TABLE agente_execucoes ADD CONSTRAINT agente_execucoes_modo_valido
    CHECK (modo IN ('SUGESTAO', 'AUTOMATICO', 'TESTE', 'CATALOGO'));
