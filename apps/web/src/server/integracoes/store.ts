import { z } from 'zod';
import { query } from '../db';
import { AppError, badRequest } from '../errors';
import { CATALOGO, integracao, type Campo, type ChaveIntegracao } from './catalogo';
import { cifraDisponivel, cifrar, decifrar, finalDoSegredo } from './cripto';

/**
 * Credenciais das integrações: painel primeiro, variável de ambiente depois,
 * campo a campo. Assim quem já configurou pelo Vercel não perde nada, e quem
 * prefere o painel não precisa de deploy.
 *
 * Leitura com cache curto (15 s) por instância: o webhook do WhatsApp lê a
 * credencial a cada mensagem, e uma ida ao banco por mensagem só para isso
 * seria desperdício. Salvar pelo painel limpa o cache desta instância; as
 * outras se atualizam em até 15 s.
 */

type Registro = {
  chave: ChaveIntegracao;
  ativo: boolean;
  config: Record<string, string>;
  segredos: Record<string, string>;
  segredosIlegiveis: boolean;
  resumo: Record<string, string>;
  testadoEm: string | null;
  testeOk: boolean | null;
  testeDetalhe: string | null;
  updatedAt: string | null;
};

const TTL_MS = 15_000;
const cache = globalThis as unknown as { __integracoes?: Map<string, { em: number; valor: Registro | null }> };
cache.__integracoes ??= new Map();

export function limparCache() {
  cache.__integracoes!.clear();
}

async function carregar(chave: ChaveIntegracao): Promise<Registro | null> {
  const guardado = cache.__integracoes!.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.valor;

  let linha: Record<string, unknown> | undefined;
  try {
    linha = (
      await query(
        `SELECT chave, ativo, config, segredos, segredos_resumo, testado_em, teste_ok, teste_detalhe, updated_at
           FROM integracoes WHERE chave = $1`,
        [chave]
      )
    ).rows[0];
  } catch (error) {
    // Banco sem a migração 016 ainda: segue só com as variáveis de ambiente.
    if ((error as { code?: string }).code === '42P01') return null;
    throw error;
  }

  let valor: Registro | null = null;
  if (linha) {
    let segredos: Record<string, string> = {};
    let ilegiveis = false;
    if (typeof linha.segredos === 'string' && linha.segredos) {
      try {
        segredos = JSON.parse(decifrar(linha.segredos, chave));
      } catch {
        // Chave de cifra trocada ou ausente: os segredos existem mas não abrem.
        ilegiveis = true;
        console.error(`[integracoes] segredos de ${chave} ilegíveis — confira INTEGRATIONS_ENCRYPTION_KEY`);
      }
    }
    valor = {
      chave,
      ativo: Boolean(linha.ativo),
      config: (linha.config ?? {}) as Record<string, string>,
      segredos,
      segredosIlegiveis: ilegiveis,
      resumo: (linha.segredos_resumo ?? {}) as Record<string, string>,
      testadoEm: linha.testado_em ? new Date(linha.testado_em as string).toISOString() : null,
      testeOk: (linha.teste_ok as boolean | null) ?? null,
      testeDetalhe: (linha.teste_detalhe as string | null) ?? null,
      updatedAt: linha.updated_at ? new Date(linha.updated_at as string).toISOString() : null
    };
  }
  cache.__integracoes!.set(chave, { em: Date.now(), valor });
  return valor;
}

type Origem = 'painel' | 'ambiente' | 'padrao' | null;

function resolverCampo(registro: Registro | null, campo: Campo): { valor: string | undefined; origem: Origem } {
  if (registro?.ativo) {
    const doPainel = campo.tipo === 'segredo' ? registro.segredos[campo.nome] : registro.config[campo.nome];
    if (doPainel !== undefined && doPainel !== '') return { valor: String(doPainel), origem: 'painel' };
    // Modo explicitamente "desligado" no painel vale mais que a env.
    if (campo.tipo === 'select' && campo.nome in registro.config) {
      return { valor: String(registro.config[campo.nome] ?? ''), origem: 'painel' };
    }
  }
  const daEnv = campo.env ? process.env[campo.env]?.trim() : undefined;
  if (daEnv) return { valor: daEnv, origem: 'ambiente' };
  if (campo.padrao !== undefined) return { valor: campo.padrao, origem: 'padrao' };
  return { valor: undefined, origem: null };
}

export async function valores(chave: ChaveIntegracao): Promise<Record<string, string | undefined>> {
  const registro = await carregar(chave);
  const saida: Record<string, string | undefined> = {};
  for (const campo of integracao(chave).campos) saida[campo.nome] = resolverCampo(registro, campo).valor;
  return saida;
}

// ---------------------------------------------------------------------------
// Acessos tipados usados pelo resto do sistema
// ---------------------------------------------------------------------------

export async function credMetaApp() {
  const v = await valores('META_APP');
  const versao = v.graphVersion && /^v\d+\.\d+$/.test(v.graphVersion) ? v.graphVersion : 'v23.0';
  return { appId: v.appId, appSecret: v.appSecret, verifyToken: v.verifyToken, graphVersion: versao };
}

export async function credWhatsApp() {
  const v = await valores('WHATSAPP');
  const modo = v.modo === 'meta' || v.modo === 'simulado' ? v.modo : null;
  return { modo, phoneNumberId: v.phoneNumberId, wabaId: v.wabaId, accessToken: v.accessToken } as const;
}

export async function credInstagram() {
  const v = await valores('INSTAGRAM');
  return {
    pageId: v.pageId,
    pageToken: v.pageToken,
    igAccountId: v.igAccountId,
    configurado: Boolean(v.pageId && v.pageToken)
  };
}

export async function credAds() {
  const v = await valores('META_ADS');
  const conta = v.adAccountId?.replace(/^act_/, '');
  return {
    accountId: conta && /^\d+$/.test(conta) ? `act_${conta}` : undefined,
    token: v.accessToken,
    configurado: Boolean(conta && v.accessToken)
  };
}

export type ConfigAgente = {
  modo: 'DESLIGADO' | 'SUGERIR' | 'AUTOMATICO';
  apiKey: string | undefined;
  modelo: string;
  esforco: 'low' | 'medium' | 'high';
  instrucoes: string;
  limiteAutomatico: number;
  palavrasHumano: string[];
  somenteForaDoHorario: boolean;
  horarioInicio: string;
  horarioFim: string;
};

export async function configAgente(): Promise<ConfigAgente> {
  const v = await valores('AGENTE_IA');
  const modo = v.modo === 'SUGERIR' || v.modo === 'AUTOMATICO' ? v.modo : 'DESLIGADO';
  const esforco = v.esforco === 'medium' || v.esforco === 'high' ? v.esforco : 'low';
  return {
    modo,
    apiKey: v.apiKey,
    modelo: v.modelo || 'claude-opus-5-5',
    esforco,
    instrucoes: v.instrucoes ?? '',
    limiteAutomatico: Math.min(50, Math.max(1, Number(v.limiteAutomatico) || 6)),
    palavrasHumano: (v.palavrasHumano ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
    somenteForaDoHorario: v.somenteForaDoHorario === 'true',
    horarioInicio: v.horarioInicio ?? '09:00',
    horarioFim: v.horarioFim ?? '18:00'
  };
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

/** O que a tela mostra: nunca o valor de um segredo, só se existe e de onde vem. */
export async function descreverIntegracoes() {
  const saida = [];
  for (const item of CATALOGO) {
    const registro = await carregar(item.chave);
    saida.push({
      ...item,
      ativo: registro?.ativo ?? true,
      salvaNoPainel: Boolean(registro),
      segredosIlegiveis: registro?.segredosIlegiveis ?? false,
      teste: registro?.testadoEm
        ? { em: registro.testadoEm, ok: registro.testeOk, detalhe: registro.testeDetalhe }
        : null,
      atualizadoEm: registro?.updatedAt ?? null,
      campos: item.campos.map((campo) => {
        const { valor, origem } = resolverCampo(registro, campo);
        return campo.tipo === 'segredo'
          ? {
              ...campo,
              definido: Boolean(valor),
              origem,
              final:
                origem === 'painel'
                  ? (registro?.resumo[campo.nome] ?? '…')
                  : valor
                    ? finalDoSegredo(valor)
                    : null
            }
          : { ...campo, valor: valor ?? '', origem };
      })
    });
  }
  return { integracoes: saida, cifraDisponivel: cifraDisponivel() };
}

export const salvarSchema = z.object({
  ativo: z.boolean().optional(),
  config: z.record(z.string(), z.string().max(8000)).default({}),
  /** `null` ou "" apaga o segredo do painel (volta a valer a variável de ambiente). */
  segredos: z.record(z.string(), z.string().max(4000).nullable()).default({})
});

function validarCampo(campo: Campo, valor: string) {
  if (campo.max && valor.length > campo.max) throw badRequest('INVALID_INPUT', { campo: campo.nome, motivo: 'longo demais' });
  if (campo.tipo === 'select' && campo.opcoes && !campo.opcoes.some((o) => o.valor === valor)) {
    throw badRequest('INVALID_INPUT', { campo: campo.nome, motivo: 'opção inválida' });
  }
  if (campo.tipo === 'booleano' && valor !== 'true' && valor !== 'false') {
    throw badRequest('INVALID_INPUT', { campo: campo.nome, motivo: 'use true ou false' });
  }
  if (valor && campo.padraoRegex && !new RegExp(campo.padraoRegex).test(valor)) {
    throw badRequest('INVALID_INPUT', { campo: campo.nome, motivo: 'formato inválido' });
  }
}

export async function salvarIntegracao(
  chave: ChaveIntegracao,
  input: z.infer<typeof salvarSchema>,
  autorId: string
) {
  const definicao = integracao(chave);
  const porNome = new Map(definicao.campos.map((c) => [c.nome, c]));
  limparCache();
  const atual = await carregar(chave);
  if (atual?.segredosIlegiveis && Object.keys(input.segredos).length === 0) {
    // Regravar sem decifrar apagaria segredos que talvez ainda abram com a chave certa.
    throw new AppError(409, 'INTEGRATION_SECRETS_UNREADABLE');
  }

  const config: Record<string, string> = { ...(atual?.config ?? {}) };
  for (const [nome, valor] of Object.entries(input.config)) {
    const campo = porNome.get(nome);
    if (!campo || campo.tipo === 'segredo') throw badRequest('INVALID_INPUT', { campo: nome, motivo: 'campo desconhecido' });
    const limpo = valor.trim();
    validarCampo(campo, limpo);
    if (limpo === '' && campo.tipo !== 'select') delete config[nome];
    else config[nome] = limpo;
  }

  const segredos: Record<string, string> = { ...(atual?.segredos ?? {}) };
  for (const [nome, valor] of Object.entries(input.segredos)) {
    const campo = porNome.get(nome);
    if (!campo || campo.tipo !== 'segredo') throw badRequest('INVALID_INPUT', { campo: nome, motivo: 'campo desconhecido' });
    const limpo = valor?.trim() ?? '';
    if (!limpo) {
      delete segredos[nome];
      continue;
    }
    validarCampo(campo, limpo);
    segredos[nome] = limpo;
  }

  const temSegredo = Object.keys(segredos).length > 0;
  if (temSegredo && !cifraDisponivel()) throw new AppError(503, 'INTEGRATIONS_KEY_MISSING');

  const resumo = Object.fromEntries(Object.entries(segredos).map(([k, v]) => [k, finalDoSegredo(v)]));
  await query(
    `INSERT INTO integracoes (chave, ativo, config, segredos, segredos_resumo, atualizado_por, updated_at,
                              testado_em, teste_ok, teste_detalhe)
     VALUES ($1, $2, $3, $4, $5, $6, now(), NULL, NULL, NULL)
     ON CONFLICT (chave) DO UPDATE SET
       ativo = EXCLUDED.ativo, config = EXCLUDED.config, segredos = EXCLUDED.segredos,
       segredos_resumo = EXCLUDED.segredos_resumo, atualizado_por = EXCLUDED.atualizado_por,
       updated_at = now(), testado_em = NULL, teste_ok = NULL, teste_detalhe = NULL`,
    [
      chave,
      input.ativo ?? atual?.ativo ?? true,
      JSON.stringify(config),
      temSegredo ? cifrar(JSON.stringify(segredos), chave) : null,
      JSON.stringify(resumo),
      autorId
    ]
  );
  limparCache();
  return { camposAlterados: [...Object.keys(input.config), ...Object.keys(input.segredos)] };
}

export async function removerIntegracao(chave: ChaveIntegracao) {
  await query(`DELETE FROM integracoes WHERE chave = $1`, [chave]);
  limparCache();
}

export async function registrarTeste(chave: ChaveIntegracao, ok: boolean, detalhe: string) {
  await query(
    `INSERT INTO integracoes (chave, testado_em, teste_ok, teste_detalhe)
     VALUES ($1, now(), $2, $3)
     ON CONFLICT (chave) DO UPDATE SET testado_em = now(), teste_ok = $2, teste_detalhe = $3`,
    [chave, ok, detalhe.slice(0, 500)]
  );
  limparCache();
}
