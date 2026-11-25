/**
 * Ferramentas do painel administrativo. Cada uma é liberada ou bloqueada por
 * conta; a mesma chave protege a página e as rotas `/api/admin/*` dela.
 */
export const FERRAMENTAS = [
  { chave: 'menu', href: '/admin', rotulo: 'Menu', hint: 'Tarifas, Pix e bloqueios' },
  { chave: 'dashboard', href: '/admin/dashboard', rotulo: 'Dashboard', hint: 'Vendas e ocupação' },
  { chave: 'atendimento', href: '/admin/atendimento', rotulo: 'Atendimento', hint: 'WhatsApp e Instagram Direct' },
  { chave: 'crm', href: '/admin/crm', rotulo: 'CRM', hint: 'Funil de oportunidades' },
  { chave: 'marketing', href: '/admin/marketing', rotulo: 'Marketing', hint: 'Anúncios, origem e retorno' },
  { chave: 'catalogo', href: '/admin/catalogo', rotulo: 'Catálogo', hint: 'Fotos do Instagram por espaço' },
  { chave: 'seo', href: '/admin/seo', rotulo: 'SEO', hint: 'Google: buscas e indexação' },
  { chave: 'clientes', href: '/admin/clientes', rotulo: 'Clientes', hint: 'Histórico e pagamentos' },
  { chave: 'agenda', href: '/admin/agenda', rotulo: 'Agenda', hint: 'Chegadas, saídas e bloqueios' },
  { chave: 'usuarios', href: '/admin/usuarios', rotulo: 'Usuários', hint: 'Acessos e senhas' },
  { chave: 'log', href: '/admin/log', rotulo: 'Log', hint: 'Tudo que aconteceu no site' },
  { chave: 'configuracoes', href: '/admin/configuracoes', rotulo: 'Configurações', hint: 'Integrações e agente de IA' }
] as const;

export type Ferramenta = (typeof FERRAMENTAS)[number]['chave'];
export const CHAVES_FERRAMENTAS = FERRAMENTAS.map((f) => f.chave) as [Ferramenta, ...Ferramenta[]];

export function ehFerramenta(valor: string): valor is Ferramenta {
  return (CHAVES_FERRAMENTAS as string[]).includes(valor);
}

/** Endereço da área exclusiva — só aparece para a conta Dev. */
export const AREA_DEV = '/admin/dev';
