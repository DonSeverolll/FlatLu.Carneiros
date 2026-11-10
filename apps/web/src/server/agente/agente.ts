import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db';
import { AppError } from '../errors';
import { addDaysIso, isIsoDate, nightsBetween, todayIso } from '../dates';
import { findProperty } from '../property';
import { quoteForProperty } from '../quote';
import { depositFor } from '../rates';
import { addActivity } from '../crm';
import { configAgente, type ConfigAgente } from '../integracoes/store';
import { INSTRUCOES_PADRAO_AGENTE } from '../integracoes/catalogo';
import { enviarMensagem } from '../atendimento/inbox';
import {
  dentroDoHorario,
  montarMensagens,
  montarSistema,
  pedeHumano,
  type ContextoNegocio,
  type MensagemHistorico
} from './regras';

/**
 * Agente de IA do atendimento.
 *
 * Duas ferramentas, de propósito poucas: consultar disponibilidade e preço
 * (o mesmo motor de tarifas que a reserva usa — o agente não tem como inventar
 * valor) e transferir para humano. Ele não reserva, não cancela e não mexe em
 * pagamento: essas ações continuam com o hóspede no site ou com a equipe.
 */

const MAX_VOLTAS = 4;
/** Espera antes de responder sozinho: o cliente costuma mandar 2 ou 3 mensagens seguidas. */
const ESPERA_MS = 4_000;
const MENSAGEM_DE_TRANSFERENCIA =
  'Obrigado pela mensagem! Vou passar sua conversa para alguém da nossa equipe, que já te responde por aqui. 🙂';

type Resultado = 'RESPONDEU' | 'SUGERIU' | 'TRANSFERIU' | 'IGNOROU' | 'RECUSOU' | 'ERRO';
type Modo = 'SUGESTAO' | 'AUTOMATICO' | 'TESTE';

export type Execucao = {
  resultado: Resultado;
  texto: string | null;
  motivo: string | null;
  ferramentas: { nome: string; entrada: unknown; saida: unknown }[];
  tokens: { entrada: number; saida: number };
};

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'consultar_disponibilidade',
    description:
      'Consulta no sistema de reservas se um espaço está livre entre duas datas e quanto custa a estadia. ' +
      'Use sempre que o cliente perguntar por vaga, datas ou preço. Para uso diurno (sem pernoite), entrada = saída.',
    input_schema: {
      type: 'object',
      properties: {
        espaco: { type: 'string', description: 'Código do espaço, como aparece na lista de espaços (ex.: "flat-praia-de-carneiros").' },
        entrada: { type: 'string', description: 'Data de entrada, AAAA-MM-DD.' },
        saida: { type: 'string', description: 'Data de saída, AAAA-MM-DD. Igual à entrada para uso diurno.' },
        hospedes: { type: 'integer', description: 'Número de hóspedes. Use 2 se o cliente não disse.' }
      },
      required: ['espaco', 'entrada', 'saida', 'hospedes'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'transferir_para_humano',
    description:
      'Passa a conversa para um atendente da equipe. Use para reclamação, reembolso, cancelamento, negociação de preço, ' +
      'pedido fora das regras ou quando você não tiver a informação. Depois de chamar, não escreva mais nada.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Motivo em uma frase, para o atendente.' } },
      required: ['motivo'],
      additionalProperties: false
    },
    strict: true
  }
];

export async function consultarDisponibilidade(entrada: unknown) {
  const e = (entrada ?? {}) as { espaco?: unknown; entrada?: unknown; saida?: unknown; hospedes?: unknown };
  const espaco = typeof e.espaco === 'string' ? e.espaco.trim() : '';
  const ci = typeof e.entrada === 'string' ? e.entrada : '';
  const co = typeof e.saida === 'string' ? e.saida : '';
  const hospedes = Number.isInteger(e.hospedes) ? Number(e.hospedes) : 2;

  if (!espaco || !isIsoDate(ci) || !isIsoDate(co)) {
    return { erro: 'Informe espaço e datas no formato AAAA-MM-DD.' };
  }
  let propriedade;
  try {
    propriedade = await findProperty(espaco);
  } catch {
    return { erro: `Espaço "${espaco}" não existe. Use um dos códigos da lista de espaços.` };
  }
  const hoje = todayIso(propriedade.timezone);
  if (ci < hoje) return { disponivel: false, motivo: 'A data de entrada já passou.' };
  if (co < ci) return { disponivel: false, motivo: 'A saída é antes da entrada.' };
  if (nightsBetween(ci, co) > 60) return { erro: 'Consulte no máximo 60 noites por vez.' };
  if (hospedes > propriedade.max_guests) {
    return { disponivel: false, motivo: `O espaço acomoda até ${propriedade.max_guests} hóspedes.` };
  }

  // Noites ocupadas. Uso diurno (entrada = saída) ocupa aquele dia.
  const fim = ci === co ? addDaysIso(ci, 1) : co;
  const ocupado = await query<{ ocupado: boolean }>(
    `SELECT EXISTS (
        SELECT 1 FROM inventory_blocks
         WHERE property_id = $1 AND active = true
           AND blocked_nights && daterange($2::date, $3::date)
     ) AS ocupado`,
    [propriedade.id, ci, fim]
  );
  if (ocupado.rows[0]?.ocupado) {
    return { disponivel: false, motivo: 'Já existe reserva ou bloqueio em pelo menos uma dessas noites.' };
  }

  const orcamento = await quoteForProperty(propriedade, ci, co);
  if (!orcamento.bookable || orcamento.totalCents <= 0) {
    const problema = orcamento.problems[0];
    return {
      disponivel: false,
      motivo:
        problema?.code === 'BELOW_MIN_NIGHTS'
          ? `Mínimo de ${problema.minNights} noite(s) para essa entrada.`
          : problema?.code === 'PERIOD_REQUIRES_FULL_STAY'
            ? `${problema.periodName} é pacote fechado de ${problema.startsOn} a ${problema.endsOn}.`
            : problema?.code === 'ARRIVAL_NOT_ALLOWED'
              ? 'Não há entrada nesse dia da semana.'
              : 'Tarifa dessas datas ainda não publicada — confirmar com a equipe.'
    };
  }
  const sinal = depositFor(orcamento.totalCents, propriedade.deposit_percentage);
  return {
    disponivel: true,
    espaco: propriedade.name,
    entrada: ci,
    saida: co,
    noites: orcamento.nights,
    total: (orcamento.totalCents / 100).toFixed(2),
    sinal: (sinal / 100).toFixed(2),
    moeda: 'BRL',
    observacao: 'Disponibilidade no momento da consulta; a reserva só é garantida ao concluir no site.'
  };
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

async function contextoNegocio(): Promise<ContextoNegocio> {
  const espacos = await query<{
    slug: string;
    nome: string;
    local: string | null;
    capacidade: number;
    check_in: string;
    check_in_ate: string | null;
    check_out: string;
    min_noites: number;
    uso_diurno: boolean;
    descricao: string | null;
  }>(
    `SELECT slug, COALESCE(short_name, name) AS nome, location_name AS local, max_guests AS capacidade,
            to_char(check_in_time, 'HH24:MI') AS check_in, to_char(check_in_until, 'HH24:MI') AS check_in_ate,
            to_char(check_out_time, 'HH24:MI') AS check_out, min_nights AS min_noites,
            day_use_allowed AS uso_diurno, description AS descricao
       FROM properties WHERE active = true ORDER BY display_order, name`
  );
  return {
    espacos: espacos.rows.map((e) => ({
      slug: e.slug,
      nome: e.nome,
      local: e.local,
      capacidade: e.capacidade,
      checkIn: e.check_in,
      checkInAte: e.check_in_ate,
      checkOut: e.check_out,
      minNoites: e.min_noites,
      usoDiurno: e.uso_diurno,
      descricao: e.descricao
    })),
    site: process.env.SITE_URL?.trim() || null
  };
}

function dataDeHoje(): string {
  const hoje = todayIso();
  const dia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Recife' }).format(new Date());
  return `Hoje é ${hoje} (${dia}), fuso de Recife.`;
}

async function contextoDaConversa(conversaId: string): Promise<string> {
  const r = await query<Record<string, string | null>>(
    `SELECT c.canal, c.contato_nome, l.name AS lead, l.stage::text AS estagio,
            r.check_in::text AS entrada, r.check_out::text AS saida, r.status::text AS status_reserva,
            r.payment_status::text AS pagamento, COALESCE(p.short_name, p.name) AS espaco
       FROM conversas_whatsapp c
       LEFT JOIN crm_leads l ON l.id = c.lead_id
       LEFT JOIN reservations r ON r.id = c.reserva_id
       LEFT JOIN properties p ON p.id = r.property_id
      WHERE c.id = $1`,
    [conversaId]
  );
  const c = r.rows[0];
  if (!c) throw new AppError(404, 'CONVERSATION_NOT_FOUND');
  const linhas = [
    dataDeHoje(),
    `Canal: ${c.canal === 'INSTAGRAM' ? 'Instagram Direct' : 'WhatsApp'}. Cliente: ${c.lead ?? c.contato_nome ?? 'sem nome'}.`
  ];
  if (c.entrada) {
    linhas.push(
      `Este cliente já tem reserva: ${c.espaco}, de ${c.entrada} a ${c.saida} (situação ${c.status_reserva}, pagamento ${c.pagamento}).`
    );
  }
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Chamada ao modelo
// ---------------------------------------------------------------------------

function clienteAnthropic(cfg: ConfigAgente) {
  if (!cfg.apiKey) throw new AppError(503, 'AI_NOT_CONFIGURED');
  return new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2, timeout: 60_000 });
}

function traduzirErro(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new AppError(502, 'AI_AUTH_FAILED');
  if (error instanceof Anthropic.PermissionDeniedError) return new AppError(502, 'AI_AUTH_FAILED');
  if (error instanceof Anthropic.RateLimitError) return new AppError(429, 'AI_RATE_LIMITED', { retryAfterSeconds: 30 });
  if (error instanceof Anthropic.BadRequestError) return new AppError(502, 'AI_PROVIDER_ERROR', { message: error.message.slice(0, 200) });
  if (error instanceof Anthropic.APIError) return new AppError(502, 'AI_PROVIDER_ERROR', { status: error.status });
  if (error instanceof Anthropic.APIConnectionError) return new AppError(502, 'AI_PROVIDER_ERROR', { message: 'sem conexão' });
  return new AppError(500, 'AI_PROVIDER_ERROR');
}

/**
 * Loop de ferramentas. A resposta do modelo volta inteira para o histórico
 * (inclusive blocos de raciocínio), como a API exige entre voltas.
 */
async function executar(
  cfg: ConfigAgente,
  mensagens: Anthropic.Beta.BetaMessageParam[],
  contexto: string
): Promise<Execucao> {
  const cliente = clienteAnthropic(cfg);
  const negocio = await contextoNegocio();
  const sistema: Anthropic.Beta.BetaTextBlockParam[] = [
    // Parte estável (instruções + espaços) primeiro, com cache; o que muda por
    // conversa (data de hoje, reserva) depois do ponto de cache.
    {
      type: 'text',
      text: montarSistema(cfg.instrucoes.trim() || INSTRUCOES_PADRAO_AGENTE, negocio),
      cache_control: { type: 'ephemeral' }
    },
    { type: 'text', text: contexto }
  ];

  const historico = [...mensagens];
  const execucao: Execucao = { resultado: 'ERRO', texto: null, motivo: null, ferramentas: [], tokens: { entrada: 0, saida: 0 } };
  // O Haiku não tem fallback no servidor; nos demais, uma recusa por engano
  // dos classificadores é refeita por outro modelo dentro da mesma chamada.
  const comFallback = !cfg.modelo.startsWith('claude-haiku');

  for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
    let resposta: Anthropic.Beta.BetaMessage;
    try {
      resposta = await cliente.beta.messages.create({
        model: cfg.modelo,
        max_tokens: 16000,
        system: sistema,
        tools: FERRAMENTAS,
        messages: historico,
        output_config: { effort: cfg.esforco },
        ...(comFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
      });
    } catch (error) {
      throw traduzirErro(error);
    }
    execucao.tokens.entrada += resposta.usage.input_tokens ?? 0;
    execucao.tokens.saida += resposta.usage.output_tokens ?? 0;

    if (resposta.stop_reason === 'refusal') {
      return { ...execucao, resultado: 'RECUSOU', motivo: 'O modelo recusou responder.' };
    }
    if (resposta.stop_reason === 'max_tokens') {
      return { ...execucao, resultado: 'ERRO', motivo: 'Resposta cortada por tamanho.' };
    }

    historico.push({ role: 'assistant', content: resposta.content });

    if (resposta.stop_reason === 'pause_turn') continue;

    const chamadas = resposta.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use'
    );
    if (resposta.stop_reason !== 'tool_use' || !chamadas.length) {
      const texto = resposta.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return texto
        ? { ...execucao, resultado: 'RESPONDEU', texto }
        : { ...execucao, resultado: 'ERRO', motivo: 'O modelo não devolveu texto.' };
    }

    const transferencia = chamadas.find((c) => c.name === 'transferir_para_humano');
    if (transferencia) {
      const motivo = String((transferencia.input as { motivo?: unknown })?.motivo ?? 'sem motivo').slice(0, 300);
      execucao.ferramentas.push({ nome: transferencia.name, entrada: transferencia.input, saida: null });
      return { ...execucao, resultado: 'TRANSFERIU', motivo };
    }

    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const chamada of chamadas) {
      let saida: unknown;
      let erro = false;
      try {
        saida =
          chamada.name === 'consultar_disponibilidade'
            ? await consultarDisponibilidade(chamada.input)
            : { erro: `Ferramenta desconhecida: ${chamada.name}` };
      } catch (error) {
        console.error('[agente] ferramenta falhou', chamada.name, error);
        saida = { erro: 'Falha ao consultar o sistema. Diga que vai confirmar com a equipe.' };
        erro = true;
      }
      execucao.ferramentas.push({ nome: chamada.name, entrada: chamada.input, saida });
      resultados.push({
        type: 'tool_result',
        tool_use_id: chamada.id,
        content: JSON.stringify(saida),
        is_error: erro || (typeof saida === 'object' && saida !== null && 'erro' in saida)
      });
    }
    // Todos os resultados numa única mensagem, como a API espera.
    historico.push({ role: 'user', content: resultados });
  }
  return { ...execucao, resultado: 'ERRO', motivo: 'Excedeu o número de consultas.' };
}

async function registrar(conversaId: string | null, modo: Modo, cfg: ConfigAgente, e: Execucao) {
  try {
    await query(
      `INSERT INTO agente_execucoes (conversa_id, modo, resultado, modelo, input_tokens, output_tokens, ferramentas, detalhe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        conversaId,
        modo,
        modo === 'SUGESTAO' && e.resultado === 'RESPONDEU' ? 'SUGERIU' : e.resultado,
        cfg.modelo,
        e.tokens.entrada,
        e.tokens.saida,
        JSON.stringify(e.ferramentas),
        e.motivo?.slice(0, 500) ?? null
      ]
    );
  } catch (error) {
    console.error('[agente] falha ao registrar execução', error);
  }
}

async function historicoDaConversa(conversaId: string): Promise<{ msgs: MensagemHistorico[]; ultima: { id: string; direcao: string } | null }> {
  const r = await query<MensagemHistorico & { id: string }>(
    `SELECT * FROM (
        SELECT id, direcao, tipo, corpo, gerada_por_ia, COALESCE(enviada_em, created_at) AS em
          FROM mensagens_whatsapp
         WHERE conversa_id = $1 AND status <> 'FALHOU'
         ORDER BY COALESCE(enviada_em, created_at) DESC, created_at DESC
         LIMIT 30) ultimas
     ORDER BY em ASC`,
    [conversaId]
  );
  const ultima = r.rows[r.rows.length - 1];
  return { msgs: r.rows, ultima: ultima ? { id: ultima.id, direcao: ultima.direcao } : null };
}

// ---------------------------------------------------------------------------
// Pontos de entrada
// ---------------------------------------------------------------------------

/** Botão ✨ do atendimento: devolve um rascunho; nada é enviado. */
export async function sugerirResposta(conversaId: string) {
  const cfg = await configAgente();
  if (cfg.modo === 'DESLIGADO') throw new AppError(409, 'AI_DISABLED');
  const { msgs } = await historicoDaConversa(conversaId);
  const mensagens = montarMensagens(msgs);
  if (!mensagens.length) throw new AppError(409, 'AI_NOTHING_TO_ANSWER');
  const execucao = await executar(cfg, mensagens, await contextoDaConversa(conversaId)).catch(async (error) => {
    await registrar(conversaId, 'SUGESTAO', cfg, {
      resultado: 'ERRO', texto: null, motivo: (error as AppError).code ?? 'erro', ferramentas: [], tokens: { entrada: 0, saida: 0 }
    });
    throw error;
  });
  await registrar(conversaId, 'SUGESTAO', cfg, execucao);
  return {
    resultado: execucao.resultado === 'RESPONDEU' ? 'SUGERIU' : execucao.resultado,
    texto: execucao.texto,
    motivo: execucao.motivo,
    consultas: execucao.ferramentas.length
  };
}

/** Teste pela tela de Configurações, sem conversa real. */
export async function testarAgente(pergunta: string) {
  const cfg = await configAgente();
  const execucao = await executar(cfg, [{ role: 'user', content: pergunta }], `${dataDeHoje()}\nCanal: teste pelo painel.`);
  await registrar(null, 'TESTE', cfg, execucao);
  return execucao;
}

async function transferir(conversaId: string, leadId: string | null, motivo: string, avisarCliente: boolean) {
  await query(
    `UPDATE conversas_whatsapp SET ia_pausada = true, status = 'PENDENTE', updated_at = now() WHERE id = $1`,
    [conversaId]
  );
  if (leadId) {
    await addActivity(leadId, null, { kind: 'WHATSAPP', body: `Agente de IA passou a conversa para a equipe: ${motivo}` });
  }
  if (avisarCliente) {
    await enviarMensagem(
      conversaId,
      null,
      { tipo: 'TEXTO', corpo: MENSAGEM_DE_TRANSFERENCIA },
      { ia: true, contaComoContato: false }
    ).catch(
      (error) => console.error('[agente] aviso de transferência não saiu', error)
    );
  }
}

/**
 * Resposta automática, chamada depois do 200 do webhook (`after`). Cada
 * condição abaixo é um motivo legítimo para ficar calado — na dúvida, quem
 * responde é a equipe.
 */
async function responderAutomaticamente(conversaId: string) {
  const cfg = await configAgente();
  if (cfg.modo !== 'AUTOMATICO' || !cfg.apiKey) return;
  if (cfg.somenteForaDoHorario && dentroDoHorario(new Date(), cfg.horarioInicio, cfg.horarioFim)) return;

  await new Promise((resolver) => setTimeout(resolver, ESPERA_MS));

  const conversa = (
    await query<{ ia_pausada: boolean; ia_respostas: number; janela_aberta: boolean; lead_id: string | null }>(
      `SELECT ia_pausada, ia_respostas, lead_id,
              (janela_expira_em IS NOT NULL AND janela_expira_em > now()) AS janela_aberta
         FROM conversas_whatsapp WHERE id = $1`,
      [conversaId]
    )
  ).rows[0];
  if (!conversa || conversa.ia_pausada || !conversa.janela_aberta) return;

  const { msgs, ultima } = await historicoDaConversa(conversaId);
  // Outra execução (de uma mensagem mais nova) ou a equipe já respondeu.
  if (!ultima || ultima.direcao !== 'ENTRADA') return;

  if (conversa.ia_respostas >= cfg.limiteAutomatico) {
    await transferir(conversaId, conversa.lead_id, `limite de ${cfg.limiteAutomatico} respostas automáticas`, true);
    await registrar(conversaId, 'AUTOMATICO', cfg, {
      resultado: 'TRANSFERIU', texto: null, motivo: 'limite de respostas', ferramentas: [], tokens: { entrada: 0, saida: 0 }
    });
    return;
  }

  // Só o que o cliente escreveu desde a última resposta nossa.
  const recentes: string[] = [];
  for (let i = msgs.length - 1; i >= 0 && msgs[i]!.direcao === 'ENTRADA'; i -= 1) recentes.push(msgs[i]!.corpo ?? '');
  const palavra = pedeHumano(recentes.join(' '), cfg.palavrasHumano);
  if (palavra) {
    await transferir(conversaId, conversa.lead_id, `o cliente mencionou "${palavra}"`, true);
    await registrar(conversaId, 'AUTOMATICO', cfg, {
      resultado: 'TRANSFERIU', texto: null, motivo: `palavra "${palavra}"`, ferramentas: [], tokens: { entrada: 0, saida: 0 }
    });
    return;
  }

  let execucao: Execucao;
  try {
    execucao = await executar(cfg, montarMensagens(msgs), await contextoDaConversa(conversaId));
  } catch (error) {
    const falha = traduzirErro(error);
    await registrar(conversaId, 'AUTOMATICO', cfg, {
      resultado: 'ERRO', texto: null, motivo: falha.code, ferramentas: [], tokens: { entrada: 0, saida: 0 }
    });
    return;
  }

  // Chegou mensagem nova enquanto o modelo pensava: a execução dela responde.
  const depois = await historicoDaConversa(conversaId);
  if (depois.ultima?.id !== ultima.id) {
    await registrar(conversaId, 'AUTOMATICO', cfg, { ...execucao, resultado: 'IGNOROU', motivo: 'chegou mensagem mais nova' });
    return;
  }

  if (execucao.resultado === 'TRANSFERIU') {
    await transferir(conversaId, conversa.lead_id, execucao.motivo ?? 'pedido do agente', true);
  } else if (execucao.resultado === 'RESPONDEU' && execucao.texto) {
    await enviarMensagem(conversaId, null, { tipo: 'TEXTO', corpo: execucao.texto.slice(0, 4096) }, { ia: true });
  }
  await registrar(conversaId, 'AUTOMATICO', cfg, execucao);
}

export async function responderPendentes(conversaIds: string[]): Promise<void> {
  for (const id of conversaIds) {
    try {
      await responderAutomaticamente(id);
    } catch (error) {
      console.error('[agente] resposta automática falhou', id, error);
    }
  }
}
