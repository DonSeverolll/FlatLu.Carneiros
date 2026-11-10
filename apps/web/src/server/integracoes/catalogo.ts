/**
 * Catálogo das integrações: que campos cada uma tem, quais são segredos, qual
 * variável de ambiente serve de alternativa e o padrão. A tela de
 * Configurações é desenhada a partir daqui, e a validação do que se grava
 * também — um campo novo é uma linha neste arquivo, não três telas.
 */

export const CHAVES = ['META_APP', 'WHATSAPP', 'INSTAGRAM', 'META_ADS', 'AGENTE_IA'] as const;
export type ChaveIntegracao = (typeof CHAVES)[number];

export type TipoCampo = 'texto' | 'segredo' | 'select' | 'textarea' | 'numero' | 'booleano';

export type Campo = {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  /** Variável de ambiente usada quando o painel não define o campo. */
  env?: string;
  padrao?: string;
  opcoes?: { valor: string; rotulo: string }[];
  ajuda?: string;
  /** Formato aceito (texto/segredo). */
  padraoRegex?: string;
  max?: number;
};

export type Integracao = {
  chave: ChaveIntegracao;
  titulo: string;
  resumo: string;
  campos: Campo[];
  /** Passo a passo curto mostrado no card. */
  passos: string[];
  docs?: string;
};

export const INSTRUCOES_PADRAO_AGENTE = `Você atende os hóspedes do Apt Carneiros (Flat na Praia de Carneiros e os dois andares da casa em São José da Coroa Grande).

- Responda em português do Brasil, de forma calorosa e objetiva, no tom de uma conversa de WhatsApp: frases curtas, sem listas longas.
- Para qualquer pergunta sobre datas, vagas ou preço, use a ferramenta de disponibilidade. Nunca invente valor ou disponibilidade.
- Para reservar, oriente o hóspede a escolher as datas no site; não confirme reserva pela conversa.
- Transfira para um atendente humano quando houver reclamação, pedido de reembolso ou cancelamento, negociação de preço, ou quando você não tiver a informação.`;

export const CATALOGO: Integracao[] = [
  {
    chave: 'META_APP',
    titulo: 'App da Meta',
    resumo: 'Base do WhatsApp e do Instagram: assina os webhooks e protege os tokens.',
    campos: [
      { nome: 'appId', rotulo: 'ID do app', tipo: 'texto', env: 'META_APP_ID', padraoRegex: '^\\d{5,25}$' },
      { nome: 'appSecret', rotulo: 'Chave secreta do app', tipo: 'segredo', env: 'META_APP_SECRET', padraoRegex: '^[A-Za-z0-9]{16,64}$' },
      {
        nome: 'verifyToken',
        rotulo: 'Token de verificação do webhook',
        tipo: 'segredo',
        env: 'META_WEBHOOK_VERIFY_TOKEN',
        padraoRegex: '^[A-Za-z0-9._~-]{16,128}$',
        ajuda: 'Texto livre que você cola na Meta ao cadastrar o webhook. Use "Gerar".'
      },
      {
        nome: 'graphVersion',
        rotulo: 'Versão da Graph API',
        tipo: 'texto',
        env: 'META_GRAPH_VERSION',
        padrao: 'v23.0',
        padraoRegex: '^v\\d+\\.\\d+$'
      }
    ],
    passos: [
      'Em developers.facebook.com, abra o app (tipo Empresa) e copie o ID e a chave secreta em Configurações > Básico.',
      'Gere o token de verificação aqui e salve.',
      'Em WhatsApp > Configuração e em Instagram > Webhooks, cadastre as URLs abaixo com esse token.'
    ],
    docs: 'https://developers.facebook.com/docs/graph-api/webhooks/getting-started'
  },
  {
    chave: 'WHATSAPP',
    titulo: 'WhatsApp',
    resumo: 'Recebe e envia mensagens pela WhatsApp Cloud API.',
    campos: [
      {
        nome: 'modo',
        rotulo: 'Modo',
        tipo: 'select',
        env: 'WHATSAPP_PROVIDER',
        padrao: '',
        opcoes: [
          { valor: '', rotulo: 'Desligado' },
          { valor: 'simulado', rotulo: 'Simulação (não envia de verdade)' },
          { valor: 'meta', rotulo: 'WhatsApp Cloud API (produção)' }
        ]
      },
      { nome: 'phoneNumberId', rotulo: 'ID do número de telefone', tipo: 'texto', env: 'WHATSAPP_PHONE_NUMBER_ID', padraoRegex: '^\\d{5,25}$' },
      { nome: 'wabaId', rotulo: 'ID da conta do WhatsApp Business', tipo: 'texto', env: 'WHATSAPP_WABA_ID', padraoRegex: '^\\d{5,25}$' },
      {
        nome: 'accessToken',
        rotulo: 'Token de acesso permanente',
        tipo: 'segredo',
        env: 'WHATSAPP_ACCESS_TOKEN',
        ajuda: 'Token de usuário do sistema com whatsapp_business_messaging. O token temporário de 24h serve só para teste.'
      }
    ],
    passos: [
      'No app da Meta, adicione o produto WhatsApp e cadastre o número da empresa.',
      'Em WhatsApp > Configuração da API, copie o ID do número e o ID da conta.',
      'Em Configurações do negócio > Usuários do sistema, gere um token permanente e cole aqui.',
      'Assine o campo "messages" no webhook.'
    ],
    docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started'
  },
  {
    chave: 'INSTAGRAM',
    titulo: 'Instagram Direct',
    resumo: 'Conversas do Direct na mesma Central de Atendimento.',
    campos: [
      { nome: 'pageId', rotulo: 'ID da Página do Facebook', tipo: 'texto', env: 'META_PAGE_ID', padraoRegex: '^\\d{5,25}$' },
      { nome: 'igAccountId', rotulo: 'ID da conta profissional do Instagram', tipo: 'texto', env: 'META_IG_ACCOUNT_ID', padraoRegex: '^\\d{5,25}$' },
      {
        nome: 'pageToken',
        rotulo: 'Token da Página',
        tipo: 'segredo',
        env: 'META_PAGE_ACCESS_TOKEN',
        ajuda: 'Permissões instagram_basic (fotos do catálogo), instagram_manage_messages e pages_messaging.'
      }
    ],
    passos: [
      'Ligue o Instagram profissional a uma Página do Facebook.',
      'No app da Meta, adicione Messenger > Configurações do Instagram e gere o token da Página.',
      'Em Instagram > Webhooks, assine "messages" e "messaging_seen".',
      'Com instagram_basic no token, o Catálogo do painel puxa as fotos da conta.',
      'No app do Instagram: Configurações > Mensagens > permitir acesso a mensagens.'
    ],
    docs: 'https://developers.facebook.com/docs/messenger-platform/instagram'
  },
  {
    chave: 'META_ADS',
    titulo: 'Anúncios da Meta',
    resumo: 'Gasto, cliques e conversões por anúncio na tela de Marketing.',
    campos: [
      { nome: 'adAccountId', rotulo: 'ID da conta de anúncios', tipo: 'texto', env: 'META_AD_ACCOUNT_ID', padraoRegex: '^(act_)?\\d{5,25}$' },
      { nome: 'accessToken', rotulo: 'Token com ads_read', tipo: 'segredo', env: 'META_ADS_ACCESS_TOKEN' }
    ],
    passos: [
      'No Gerenciador de Negócios, copie o ID da conta de anúncios (act_…).',
      'Dê ao usuário do sistema acesso à conta e gere um token com ads_read.',
      'Salve e use "Sincronizar anúncios" na tela de Marketing (o cron também roda todo dia).'
    ],
    docs: 'https://developers.facebook.com/docs/marketing-api/insights'
  },
  {
    chave: 'AGENTE_IA',
    titulo: 'Agente de IA',
    resumo: 'Claude sugere respostas no atendimento ou responde sozinho, consultando a disponibilidade real.',
    campos: [
      {
        nome: 'modo',
        rotulo: 'Modo',
        tipo: 'select',
        padrao: 'DESLIGADO',
        opcoes: [
          { valor: 'DESLIGADO', rotulo: 'Desligado' },
          { valor: 'SUGERIR', rotulo: 'Sugerir respostas (o atendente revisa e envia)' },
          { valor: 'AUTOMATICO', rotulo: 'Responder automaticamente' }
        ]
      },
      {
        nome: 'apiKey',
        rotulo: 'Chave da API da Anthropic',
        tipo: 'segredo',
        env: 'ANTHROPIC_API_KEY',
        padraoRegex: '^sk-ant-[A-Za-z0-9_-]{20,}$',
        ajuda: 'Crie em platform.claude.com > API Keys.'
      },
      {
        nome: 'modelo',
        rotulo: 'Modelo',
        tipo: 'select',
        padrao: 'claude-opus-5-5',
        opcoes: [
          { valor: 'claude-opus-5-5', rotulo: 'Claude Opus 5.5 (mais capaz)' },
          { valor: 'claude-sonnet-5-5', rotulo: 'Claude Sonnet 5.5 (equilíbrio)' },
          { valor: 'claude-haiku-5-5', rotulo: 'Claude Haiku 5.5 (mais rápido e barato)' }
        ]
      },
      {
        nome: 'esforco',
        rotulo: 'Esforço de raciocínio',
        tipo: 'select',
        padrao: 'low',
        opcoes: [
          { valor: 'low', rotulo: 'Baixo — respostas rápidas (recomendado para conversa)' },
          { valor: 'medium', rotulo: 'Médio' },
          { valor: 'high', rotulo: 'Alto' }
        ]
      },
      {
        nome: 'instrucoes',
        rotulo: 'Instruções do agente',
        tipo: 'textarea',
        padrao: INSTRUCOES_PADRAO_AGENTE,
        max: 8000,
        ajuda: 'Tom, regras da casa, o que pode e o que não pode prometer. Os espaços, horários e políticas já vão automaticamente.'
      },
      {
        nome: 'limiteAutomatico',
        rotulo: 'Máximo de respostas automáticas por conversa',
        tipo: 'numero',
        padrao: '6',
        padraoRegex: '^([1-9]|[1-4]\\d|50)$'
      },
      {
        nome: 'palavrasHumano',
        rotulo: 'Palavras que passam a conversa para um humano',
        tipo: 'texto',
        padrao: 'reclamação, reembolso, cancelar, cancelamento, procon, advogado, urgente',
        max: 500
      },
      {
        nome: 'somenteForaDoHorario',
        rotulo: 'Responder sozinho só fora do horário de atendimento',
        tipo: 'booleano',
        padrao: 'false'
      },
      { nome: 'horarioInicio', rotulo: 'Início do horário de atendimento', tipo: 'texto', padrao: '09:00', padraoRegex: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      { nome: 'horarioFim', rotulo: 'Fim do horário de atendimento', tipo: 'texto', padrao: '18:00', padraoRegex: '^([01]\\d|2[0-3]):[0-5]\\d$' }
    ],
    passos: [
      'Crie uma chave em platform.claude.com e cole aqui.',
      'Comece em "Sugerir respostas": o botão ✨ aparece no atendimento e nada sai sem revisão.',
      'Quando confiar no tom, passe para "Responder automaticamente". O atendente que responde numa conversa pausa o agente nela.'
    ],
    docs: 'https://platform.claude.com/docs'
  }
];

export function integracao(chave: ChaveIntegracao): Integracao {
  return CATALOGO.find((i) => i.chave === chave)!;
}
