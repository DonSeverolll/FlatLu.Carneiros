import { AppError } from '../errors';
import { graph } from '../meta/graph';
import { testarAgente } from '../agente/agente';
import type { ChaveIntegracao } from './catalogo';
import { credAds, credInstagram, credMetaApp, credWhatsApp, registrarTeste } from './store';

/**
 * "Testar conexão": uma chamada de leitura por integração, que prova que a
 * credencial funciona sem enviar mensagem a ninguém. O resultado fica gravado
 * para a tela mostrar quando foi o último teste e se passou.
 */

type Resultado = { ok: boolean; detalhe: string; resposta?: string };

const falta = (campos: string): Resultado => ({ ok: false, detalhe: `Falta preencher: ${campos}.` });

function motivo(error: unknown): string {
  if (error instanceof AppError) {
    const d = error.details as { message?: string; metaCode?: number } | undefined;
    return [error.code, d?.metaCode, d?.message].filter(Boolean).join(' · ');
  }
  return 'erro inesperado';
}

async function testarMetaApp(): Promise<Resultado> {
  const app = await credMetaApp();
  if (!app.appId || !app.appSecret) return falta('ID do app e chave secreta');
  if (!app.verifyToken) return falta('token de verificação do webhook');
  // Token de app ("id|segredo"): só funciona se o segredo for o certo.
  const r = await graph<{ name?: string }>(app.appId, {
    token: `${app.appId}|${app.appSecret}`,
    params: { fields: 'name' }
  });
  return { ok: true, detalhe: `App "${r.name ?? app.appId}" respondeu na Graph ${app.graphVersion}.` };
}

async function testarWhatsApp(): Promise<Resultado> {
  const c = await credWhatsApp();
  if (c.modo === 'simulado') return { ok: true, detalhe: 'Modo simulação: nada é enviado de verdade.' };
  if (c.modo !== 'meta') return { ok: false, detalhe: 'WhatsApp desligado. Escolha um modo.' };
  if (!c.phoneNumberId || !c.accessToken) return falta('ID do número e token');
  const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    c.phoneNumberId,
    { token: c.accessToken, params: { fields: 'display_phone_number,verified_name,quality_rating' } }
  );
  return {
    ok: true,
    detalhe: `Número ${r.display_phone_number ?? '?'} (${r.verified_name ?? 'sem nome verificado'}), qualidade ${r.quality_rating ?? '?'}.`
  };
}

async function testarInstagram(): Promise<Resultado> {
  const c = await credInstagram();
  if (!c.pageId || !c.pageToken) return falta('ID da Página e token');
  const r = await graph<{ name?: string; instagram_business_account?: { id: string; username?: string } }>(c.pageId, {
    token: c.pageToken,
    params: { fields: 'name,instagram_business_account{id,username}' }
  });
  const ig = r.instagram_business_account;
  if (!ig) return { ok: false, detalhe: `A Página "${r.name}" não tem Instagram profissional ligado.` };
  const confere = !c.igAccountId || c.igAccountId === ig.id;
  return {
    ok: confere,
    detalhe: confere
      ? `Página "${r.name}" ligada a @${ig.username ?? ig.id}.`
      : `A Página está ligada à conta ${ig.id}, mas o campo diz ${c.igAccountId}. Corrija o ID.`
  };
}

const SITUACAO_CONTA: Record<number, string> = { 1: 'ativa', 2: 'desativada', 3: 'pagamento pendente', 7: 'em revisão', 9: 'em carência', 101: 'fechada' };

async function testarAds(): Promise<Resultado> {
  const c = await credAds();
  if (!c.accountId || !c.token) return falta('ID da conta de anúncios e token');
  const r = await graph<{ name?: string; currency?: string; account_status?: number }>(c.accountId, {
    token: c.token,
    params: { fields: 'name,currency,account_status' }
  });
  return {
    ok: r.account_status === 1,
    detalhe: `Conta "${r.name ?? c.accountId}" (${r.currency ?? '?'}), ${SITUACAO_CONTA[r.account_status ?? 0] ?? `situação ${r.account_status}`}.`
  };
}

async function testarIA(pergunta?: string): Promise<Resultado> {
  const e = await testarAgente(pergunta?.trim() || 'Olá! Tem vaga no flat no próximo fim de semana para 2 pessoas? Quanto fica?');
  const consultas = e.ferramentas.length ? ` Consultou o sistema ${e.ferramentas.length}x.` : '';
  const custo = ` Tokens: ${e.tokens.entrada} de entrada, ${e.tokens.saida} de saída.`;
  if (e.resultado === 'RESPONDEU') return { ok: true, detalhe: `Respondeu.${consultas}${custo}`, resposta: e.texto ?? '' };
  if (e.resultado === 'TRANSFERIU') return { ok: true, detalhe: `Transferiu para humano: ${e.motivo}.${custo}` };
  return { ok: false, detalhe: `${e.resultado}: ${e.motivo ?? ''}${custo}` };
}

export async function testarIntegracao(chave: ChaveIntegracao, opcoes: { pergunta?: string } = {}): Promise<Resultado> {
  let resultado: Resultado;
  try {
    switch (chave) {
      case 'META_APP':
        resultado = await testarMetaApp();
        break;
      case 'WHATSAPP':
        resultado = await testarWhatsApp();
        break;
      case 'INSTAGRAM':
        resultado = await testarInstagram();
        break;
      case 'META_ADS':
        resultado = await testarAds();
        break;
      case 'AGENTE_IA':
        resultado = await testarIA(opcoes.pergunta);
        break;
    }
  } catch (error) {
    resultado = { ok: false, detalhe: motivo(error) };
  }
  await registrarTeste(chave, resultado.ok, resultado.detalhe);
  return resultado;
}
