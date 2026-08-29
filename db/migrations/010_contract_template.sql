-- 010_contract_template.sql
-- Modelo de contrato, derivado do instrumento que o escritório já usa. As
-- partes variáveis viraram marcadores {{chave}}; o restante é o texto original.
--
-- Duas observações para quem for revisar:
--
--  * A Cláusula Sexta do modelo original foi redigida para o Réveillon
--    ("irrevogável e irretratável, sem cancelamento"). Aqui ela é o marcador
--    {{politica_cancelamento}}, para que a política possa variar entre alta
--    temporada e uma diária comum de terça-feira.
--  * A Cláusula 3.2 original fixava 6 parcelas de valor específico da
--    maquininha. Isso é dado do provedor, não do contrato, então virou
--    {{condicoes_pagamento}}.

INSERT INTO contract_templates (version, title, body, active)
SELECT 'v1', 'Contrato de Locação de Imóvel por Temporada', $contract$
CONTRATO DE LOCAÇÃO DE IMÓVEL POR TEMPORADA

Pelo presente instrumento particular de Contrato de Locação de Imóvel por Temporada, regido pela Lei Federal nº 8.245, de 18 de outubro de 1991 (Lei do Inquilinato), em especial seus artigos 48 a 50, e pelo Código Civil Brasileiro, firmam entre si o presente contrato as partes adiante qualificadas:

LOCADORA: {{locadora_nome}}, {{locadora_nacionalidade}}, {{locadora_estado_civil}}, {{locadora_profissao}}, portadora da Cédula de Identidade RG nº {{locadora_rg}} {{locadora_rg_orgao}} e inscrita no CPF/MF sob o nº {{locadora_cpf}}, residente e domiciliada na {{locadora_endereco}}, {{locadora_cidade}}/{{locadora_uf}}, CEP {{locadora_cep}}.

LOCATÁRIA(O): {{locataria_nome}}, {{locataria_nacionalidade}}, {{locataria_profissao}}, portador(a) da Cédula de Identidade RG nº {{locataria_rg}} {{locataria_rg_orgao}} e inscrito(a) no CPF/MF sob o nº {{locataria_cpf}}, residente e domiciliado(a) na {{locataria_endereco}}, {{locataria_cidade}}/{{locataria_uf}}, CEP {{locataria_cep}}.

As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Locação por Temporada, que se regerá pelas cláusulas e condições a seguir expostas:

CLÁUSULA PRIMEIRA — DO OBJETO DA LOCAÇÃO

1.1. O objeto do presente contrato é a locação temporária do imóvel tipo {{imovel_tipo}}, localizado na {{imovel_endereco}}, {{imovel_cidade}}/{{imovel_uf}}, CEP {{imovel_cep}}, devidamente mobiliado e equipado com móveis e eletrodomésticos, para uso estritamente residencial e de lazer da(o) LOCATÁRIA(O) e de seus acompanhantes autorizados, vedada qualquer outra finalidade.

CLÁUSULA SEGUNDA — DO PRAZO E DA VIGÊNCIA

2.1. A locação terá a duração exata do período de temporada compreendido entre os dias {{checkin_extenso}} e {{checkout_extenso}}, data em que o imóvel deverá ser desocupado pontualmente.

2.2. A entrada no imóvel (check-in) dar-se-á a partir das {{checkin_hora}} horas do dia {{checkin_extenso}}, e a saída do imóvel (check-out) dar-se-á impreterivelmente até as {{checkout_hora}} horas do dia {{checkout_extenso}}.

CLÁUSULA TERCEIRA — DO PREÇO E DA FORMA DE PAGAMENTO

3.1. O preço certo e ajustado para a totalidade do período locado é de {{valor_total}} ({{valor_total_extenso}}).

3.2. {{condicoes_pagamento}}

CLÁUSULA QUARTA — DA CONFIRMAÇÃO DA RESERVA

4.1. O envio deste instrumento e do link de pagamento não constituem reserva automática do imóvel. A reserva do imóvel para o período contratado somente estará formalmente CONFIRMADA após a efetiva compensação e aprovação do pagamento da entrada descrita na Cláusula 3.2.

CLÁUSULA QUINTA — DA CAPACIDADE MÁXIMA DE HÓSPEDES

5.1. A locação destina-se ao abrigo de, no máximo, {{capacidade}} ({{capacidade_extenso}}) pessoas, incluindo a(o) LOCATÁRIA(O), acompanhantes e eventuais visitantes.

5.2. Caso seja constatado no ato do check-in o comparecimento ou intenção de ocupação por número superior ao limite máximo estipulado, a locação será sumariamente CANCELADA, com a consequente devolução integral dos valores pagos até o momento, sendo vedada a entrada e permanência do grupo excedente no imóvel.

CLÁUSULA SEXTA — DO CANCELAMENTO, DESISTÊNCIA E NO-SHOW

6.1. {{politica_cancelamento}}

6.2. Na hipótese de no-show (não comparecimento da(o) LOCATÁRIA(O) na data estipulada para o check-in), a reserva será mantida sem direito a reembolso ou abatimento proporcional, tendo em vista que o imóvel estará reservado exclusivamente à(ao) LOCATÁRIA(O) e retirado das plataformas de anúncio e locação durante todo o período contratado.

CLÁUSULA SÉTIMA — DAS REGRAS DE USO E CONVERGÊNCIA CONDOMINIAL

7.1. A(O) LOCATÁRIA(O) declara ciência de que o imóvel situa-se em condomínio residencial, devendo respeitar estritamente a Convenção Condominial e o Regimento Interno, especialmente quanto ao limite de ruído, horários de silêncio e regras de utilização das áreas comuns.

7.2. É expressamente vedada a realização de festas, eventos, recepções com som alto ou a permanência de número de ocupantes superior à capacidade nominal do imóvel estipulada na Cláusula Quinta.

7.3. A(O) LOCATÁRIA(O) recebe o imóvel, seus móveis, eletrodomésticos e utensílios em perfeito estado de conservação, higiene e funcionamento, obrigando-se a devolvê-los nas mesmas condições. Quaisquer avarias ou danos causados ao patrimônio serão de responsabilidade integral da(o) LOCATÁRIA(O), devendo esta(e) ressarcir imediatamente os prejuízos causados.

CLÁUSULA OITAVA — DO FORO DE ELEIÇÃO

8.1. Para dirimir quaisquer controvérsias oriundas do presente contrato, as partes elegem o Foro da Comarca de {{foro}}, Estado de Pernambuco, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

E, por estarem assim justas e contratadas, as partes assinam eletronicamente o presente instrumento para que produza seus jurídicos e legais efeitos.

{{cidade_assinatura}}, {{data_assinatura}}.

{{locadora_nome}}
LOCADORA

{{locataria_nome}}
LOCATÁRIA(O)
$contract$, true
WHERE NOT EXISTS (SELECT 1 FROM contract_templates WHERE version = 'v1');

-- ---------------------------------------------------------------------------
-- Política de cancelamento por unidade. O padrão é o da alta temporada, que é
-- o texto que o escritório já usa; períodos comuns podem receber outro.
-- ---------------------------------------------------------------------------
ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;

UPDATE properties SET cancellation_policy =
  'Dado o caráter temporário da locação e a alta demanda do período, ressalvada a hipótese prevista na Cláusula 5.2, o presente contrato possui caráter irrevogável e irretratável, NÃO SENDO ACEITO NENHUM TIPO DE CANCELAMENTO OU DESISTÊNCIA por iniciativa da(o) LOCATÁRIA(O) após a confirmação da reserva. Em caso de desistência, rescisão antecipada ou cancelamento por qualquer motivo, o valor pago a título de entrada não será ressarcido, retendo a LOCADORA a totalidade da quantia a título de cláusula penal compensatória pela indisponibilidade do imóvel.'
WHERE cancellation_policy IS NULL;
