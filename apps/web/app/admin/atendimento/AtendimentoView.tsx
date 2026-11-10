'use client';

import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, api, messageFor } from '@/lib/api';
import { CRM_STAGE, ORIGEM_CANAL, PAYMENT_LABEL, STATUS_LABEL, brl, shortDate } from '@/lib/format';

type Canal = 'WHATSAPP' | 'INSTAGRAM';
type StatusConversa = 'ABERTA' | 'PENDENTE' | 'RESOLVIDA';

type Conversa = {
  id: string;
  canal: Canal;
  contato_externo_id: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  status: StatusConversa;
  nao_lidas: number;
  ultima_mensagem_em: string | null;
  ultima_mensagem_previa: string | null;
  janela_expira_em: string | null;
  janela_aberta: boolean;
  lead_id: string | null;
  reserva_id: string | null;
  referral: { adId?: string | null; headline?: string | null; sourceUrl?: string | null } | null;
  lead_nome: string | null;
  lead_estagio: string | null;
  origem_canal: string | null;
  unidade: string | null;
  unidade_cor: string | null;
  responsavel: string | null;
  ia_pausada: boolean;
  ia_respostas: number;
};

type Mensagem = {
  id: string;
  direcao: 'ENTRADA' | 'SAIDA';
  tipo: string;
  corpo: string | null;
  midia_url: string | null;
  midia_mime: string | null;
  midia_nome_arquivo: string | null;
  midia_baixavel: boolean;
  status: string;
  erro: string | null;
  em: string;
  autor: string | null;
  gerada_por_ia: boolean;
};

type Lead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  origem_canal: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ad_id: string | null;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  next_action: string | null;
};

type Reserva = {
  id: string;
  check_in: string;
  check_out: string;
  status: string;
  payment_status: string;
  total_amount: string;
  deposit_amount: string;
  guest_count: number;
  unidade: string;
  unidade_cor: string | null;
  contrato_assinado: boolean;
};

type Lista = {
  conversas: Conversa[];
  porStatus: { status: string; total: string; nao_lidas: string }[];
  modo: { whatsapp: 'meta' | 'simulado' | null; instagram: boolean; agente: 'DESLIGADO' | 'SUGERIR' | 'AUTOMATICO' };
};

type Detalhe = { conversa: Conversa; mensagens: Mensagem[]; lead: Lead | null; reserva: Reserva | null; cursor: string };

type Anexo = { midiaId?: string; midiaUrl?: string; tipo: string; midiaMime?: string; midiaNomeArquivo?: string };

const ABAS: { valor: StatusConversa | 'TODAS'; rotulo: string }[] = [
  { valor: 'ABERTA', rotulo: 'Abertas' },
  { valor: 'PENDENTE', rotulo: 'Pendentes' },
  { valor: 'RESOLVIDA', rotulo: 'Resolvidas' },
  { valor: 'TODAS', rotulo: 'Todas' }
];

const POLL_LISTA_MS = 8_000;
const POLL_CONVERSA_MS = 4_000;

function nomeDe(c: Pick<Conversa, 'contato_nome' | 'lead_nome' | 'contato_telefone' | 'canal'>) {
  return c.contato_nome ?? c.lead_nome ?? c.contato_telefone ?? (c.canal === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp');
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function quandoCurto(iso: string | null) {
  if (!iso) return '';
  const data = new Date(iso);
  const hoje = new Date();
  if (data.toDateString() === hoje.toDateString()) return hora(iso);
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) return 'ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function rotuloDia(iso: string) {
  const curto = quandoCurto(iso);
  if (curto === 'ontem') return 'Ontem';
  if (curto.includes(':')) return 'Hoje';
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

/** Junta por id: o polling devolve linhas repetidas de propósito (folga do cursor). */
function mesclar(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  if (!novas.length) return atuais;
  const porId = new Map(atuais.map((m) => [m.id, m]));
  for (const m of novas) porId.set(m.id, m);
  return [...porId.values()].sort((a, b) => a.em.localeCompare(b.em));
}

/** Upload multipart: `api()` só fala JSON. Renova a sessão uma vez em 401. */
async function enviarArquivo(arquivo: File, tentativa = 0): Promise<Anexo & { simulado: boolean }> {
  const form = new FormData();
  form.set('arquivo', arquivo);
  const resposta = await fetch('/api/admin/atendimento/midia', {
    method: 'POST',
    body: form,
    credentials: 'same-origin'
  });
  if (resposta.status === 401 && tentativa === 0) {
    const renovou = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (renovou.ok) return enviarArquivo(arquivo, 1);
  }
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new ApiError(resposta.status, corpo?.error ?? 'REQUEST_FAILED', corpo?.details);
  return corpo;
}

function Ticks({ status }: { status: string }) {
  switch (status) {
    case 'PENDENTE':
      return <span className="tick" title="Enviando">◷</span>;
    case 'ENVIADA':
      return <span className="tick" title="Enviada">✓</span>;
    case 'ENTREGUE':
      return <span className="tick" title="Entregue">✓✓</span>;
    case 'LIDA':
      return <span className="tick lida" title="Lida">✓✓</span>;
    case 'FALHOU':
      return <span className="tick falhou" title="Não enviada">!</span>;
    default:
      return null;
  }
}

function Midia({ m }: { m: Mensagem }) {
  const src = m.midia_baixavel
    ? `/api/admin/atendimento/midia/${m.id}`
    : m.midia_url ?? null;
  if (!src) {
    if (['IMAGEM', 'VIDEO', 'PDF', 'DOCUMENTO', 'AUDIO'].includes(m.tipo)) {
      return <span className="bubble-file">📎 {m.midia_nome_arquivo ?? m.tipo.toLowerCase()} (simulado)</span>;
    }
    return null;
  }
  if (m.tipo === 'IMAGEM') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={m.midia_nome_arquivo ?? 'Imagem recebida'} className="bubble-img" loading="lazy" src={src} />;
  }
  if (m.tipo === 'VIDEO') return <video className="bubble-img" controls preload="metadata" src={src} />;
  if (m.tipo === 'AUDIO') return <audio controls preload="none" src={src} />;
  return (
    <a className="bubble-file" href={src} rel="noreferrer" target="_blank">
      {m.tipo === 'PDF' ? '📄' : '📎'} {m.midia_nome_arquivo ?? 'Abrir arquivo'}
    </a>
  );
}

/**
 * Central de Atendimento: lista de conversas, conversa ativa e ficha do lead.
 *
 * Atualização por polling curto, não WebSocket: funções do Vercel não mantêm
 * conexão aberta, e a cada poucos segundos a tela pede só o que mudou desde o
 * último cursor (mensagem nova ou status novo).
 */
export default function AtendimentoView() {
  const [aba, setAba] = useState<StatusConversa | 'TODAS'>('ABERTA');
  const [canal, setCanal] = useState<Canal | ''>('');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Lista | null>(null);
  const [ativaId, setAtivaId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Omit<Detalhe, 'mensagens' | 'cursor'> | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [urlMidia, setUrlMidia] = useState('');
  const [tipoUrl, setTipoUrl] = useState('VIDEO');
  const [modelo, setModelo] = useState({ nome: '', idioma: 'pt_BR' });
  const [enviando, setEnviando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [aviso, setAviso] = useState('');

  const cursor = useRef<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  // ---- Lista --------------------------------------------------------------

  const carregarLista = useCallback(async () => {
    const params = new URLSearchParams({ status: aba });
    if (canal) params.set('canal', canal);
    if (busca.trim()) params.set('busca', busca.trim());
    try {
      setLista(await api<Lista>(`/api/admin/atendimento/conversas?${params.toString()}`));
    } catch (error) {
      setAviso(messageFor(error));
    }
  }, [aba, canal, busca]);

  useEffect(() => {
    void carregarLista();
    const timer = window.setInterval(() => {
      if (!document.hidden) void carregarLista();
    }, POLL_LISTA_MS);
    return () => window.clearInterval(timer);
  }, [carregarLista]);

  // ---- Conversa ativa ------------------------------------------------------

  const abrir = useCallback(async (id: string) => {
    setAtivaId(id);
    setMensagens([]);
    setDetalhe(null);
    setAnexo(null);
    setAviso('');
    cursor.current = null;
    try {
      const dados = await api<Detalhe>(`/api/admin/atendimento/conversas/${id}`);
      setDetalhe({ conversa: dados.conversa, lead: dados.lead, reserva: dados.reserva });
      setMensagens(dados.mensagens);
      cursor.current = dados.cursor;
      if (dados.conversa.nao_lidas > 0) {
        await api(`/api/admin/atendimento/conversas/${id}/lida`, { method: 'POST' });
        void carregarLista();
      }
    } catch (error) {
      setAviso(messageFor(error));
    }
  }, [carregarLista]);

  // Vindo do CRM ("Conversar no WhatsApp"): abre a conversa indicada.
  // Só uma vez: `abrir` muda de identidade a cada filtro, e reabrir a conversa
  // do link sempre que o atendente troca de aba seria um sequestro da tela.
  const abriuDoLink = useRef(false);
  useEffect(() => {
    if (abriuDoLink.current) return;
    abriuDoLink.current = true;
    const alvo = new URLSearchParams(window.location.search).get('c');
    if (alvo && /^[0-9a-f-]{36}$/i.test(alvo)) {
      setAba('TODAS');
      void abrir(alvo);
    }
  }, [abrir]);

  useEffect(() => {
    if (!ativaId) return;
    const timer = window.setInterval(async () => {
      if (document.hidden || !cursor.current) return;
      try {
        const dados = await api<{ conversa: Conversa; mensagens: Mensagem[]; cursor: string }>(
          `/api/admin/atendimento/conversas/${ativaId}?desde=${encodeURIComponent(cursor.current)}`
        );
        cursor.current = dados.cursor;
        setDetalhe((atual) => (atual ? { ...atual, conversa: dados.conversa } : atual));
        setMensagens((atuais) => mesclar(atuais, dados.mensagens));
        // Chegou mensagem com a conversa aberta na tela: já está lida.
        if (dados.conversa.nao_lidas > 0) {
          await api(`/api/admin/atendimento/conversas/${ativaId}/lida`, { method: 'POST' });
        }
      } catch {
        // Falha de polling é transitória; a próxima rodada tenta de novo.
      }
    }, POLL_CONVERSA_MS);
    return () => window.clearInterval(timer);
  }, [ativaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [mensagens.length, ativaId]);

  const conversa = detalhe?.conversa ?? null;
  const modo = lista?.modo;
  const simulado = modo?.whatsapp === 'simulado';
  const janelaFechada = Boolean(conversa && !conversa.janela_aberta);

  // ---- Ações ---------------------------------------------------------------

  async function enviar(corpo: Record<string, unknown>) {
    if (!ativaId) return;
    setEnviando(true);
    setAviso('');
    try {
      const r = await api<{ mensagem: Mensagem; erro: string | null }>(
        `/api/admin/atendimento/conversas/${ativaId}/mensagens`,
        { method: 'POST', body: corpo }
      );
      setMensagens((atuais) => mesclar(atuais, [r.mensagem]));
      if (r.erro) setAviso(messageFor(new ApiError(502, r.erro)));
      setTexto('');
      setAnexo(null);
      setUrlMidia('');
      void carregarLista();
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setEnviando(false);
    }
  }

  function aoEnviar(event?: FormEvent) {
    event?.preventDefault();
    if (enviando || !conversa) return;
    if (janelaFechada) {
      if (!modelo.nome.trim()) return setAviso('Informe o nome do modelo aprovado.');
      return void enviar({ tipo: 'TEMPLATE', template: { nome: modelo.nome.trim(), idioma: modelo.idioma } });
    }
    if (anexo) {
      return void enviar({ ...anexo, corpo: texto.trim() || undefined });
    }
    if (!texto.trim()) return;
    void enviar({ tipo: 'TEXTO', corpo: texto.trim() });
  }

  function aoDigitar(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia, Shift+Enter quebra linha — como no WhatsApp Web.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      aoEnviar();
    }
  }

  async function aoEscolherArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    if (conversa?.canal === 'INSTAGRAM') {
      setAviso('No Instagram Direct, anexo só por URL pública.');
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarArquivo(arquivo);
      setAnexo({ midiaId: r.midiaId, tipo: r.tipo, midiaMime: r.midiaMime, midiaNomeArquivo: r.midiaNomeArquivo });
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setEnviando(false);
    }
  }

  function anexarUrl() {
    const url = urlMidia.trim();
    if (!/^https:\/\//.test(url)) return setAviso('A URL precisa começar com https://');
    const nome = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? '') || undefined;
    setAnexo({ midiaUrl: url, tipo: tipoUrl, midiaNomeArquivo: nome });
    setUrlMidia('');
  }

  /** Rascunho do agente de IA no campo de texto: o atendente revisa e envia. */
  async function sugerir() {
    if (!ativaId) return;
    setSugerindo(true);
    setAviso('');
    try {
      const r = await api<{ resultado: string; texto: string | null; motivo: string | null }>(
        `/api/admin/atendimento/conversas/${ativaId}/sugestao`,
        { method: 'POST' }
      );
      if (r.texto) setTexto(r.texto);
      else if (r.resultado === 'TRANSFERIU') setAviso(`O agente sugere que a equipe assuma: ${r.motivo ?? ''}`);
      else setAviso(r.motivo ?? 'O agente não conseguiu sugerir uma resposta.');
    } catch (error) {
      setAviso(messageFor(error));
    } finally {
      setSugerindo(false);
    }
  }

  async function alternarIa(pausar: boolean) {
    if (!ativaId) return;
    try {
      const r = await api<{ conversa: Conversa }>(`/api/admin/atendimento/conversas/${ativaId}`, {
        method: 'PATCH',
        body: { iaPausada: pausar }
      });
      setDetalhe((atual) => (atual ? { ...atual, conversa: r.conversa } : atual));
    } catch (error) {
      setAviso(messageFor(error));
    }
  }

  async function mudarStatus(status: StatusConversa) {
    if (!ativaId) return;
    try {
      const r = await api<{ conversa: Conversa }>(`/api/admin/atendimento/conversas/${ativaId}`, {
        method: 'PATCH',
        body: { status }
      });
      setDetalhe((atual) => (atual ? { ...atual, conversa: r.conversa } : atual));
      void carregarLista();
    } catch (error) {
      setAviso(messageFor(error));
    }
  }

  async function simular(corpo: Record<string, unknown>) {
    try {
      await api('/api/admin/atendimento/simular', { method: 'POST', body: corpo });
      void carregarLista();
    } catch (error) {
      setAviso(messageFor(error));
    }
  }

  // O formulário é guardado antes do `await`: depois dele o React já zerou
  // `event.currentTarget` e o reset quebraria.
  async function simularContato(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const elemento = event.currentTarget;
    const form = new FormData(elemento);
    await simular({
      acao: 'mensagem',
      telefone: String(form.get('telefone') ?? ''),
      nome: String(form.get('nome') ?? '') || undefined,
      texto: String(form.get('texto') ?? ''),
      adId: String(form.get('adId') ?? '') || undefined,
      anuncioTitulo: String(form.get('anuncioTitulo') ?? '') || undefined
    });
    elemento.reset();
  }

  async function simularResposta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversa?.contato_telefone) return;
    const elemento = event.currentTarget;
    const textoResposta = String(new FormData(elemento).get('texto') ?? '').trim();
    if (!textoResposta) return;
    await simular({ acao: 'mensagem', telefone: conversa.contato_telefone, texto: textoResposta });
    elemento.reset();
  }

  const ultimaSaida = [...mensagens].reverse().find((m) => m.direcao === 'SAIDA' && m.status !== 'FALHOU');

  // ---- Render ---------------------------------------------------------------

  const total = (s: string) => lista?.porStatus.find((p) => p.status === s);

  let diaAnterior = '';

  return (
    <div className={ativaId ? 'inbox has-active' : 'inbox'}>
      {/* ------------------------------------------------ Lista de conversas */}
      <aside className="inbox-list" aria-label="Conversas">
        <div className="inbox-list-head">
          <div className="inbox-title">
            <h1>Atendimento</h1>
            <span className={`mode-badge ${modo?.whatsapp ?? 'off'}`}>
              {modo?.whatsapp === 'meta' ? 'WhatsApp ativo' : simulado ? 'Simulação' : 'WhatsApp desligado'}
            </span>
          </div>
          <input
            aria-label="Buscar conversa"
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, telefone ou mensagem"
            value={busca}
          />
          <div className="inbox-tabs" role="tablist">
            {ABAS.map((a) => {
              const linha = a.valor === 'TODAS' ? null : total(a.valor);
              const naoLidas = Number(linha?.nao_lidas ?? 0);
              return (
                <button
                  aria-selected={aba === a.valor}
                  className={aba === a.valor ? 'on' : ''}
                  key={a.valor}
                  onClick={() => setAba(a.valor)}
                  role="tab"
                  type="button"
                >
                  {a.rotulo}
                  {naoLidas > 0 && <b>{naoLidas}</b>}
                </button>
              );
            })}
          </div>
          <div className="inbox-channels">
            {(['', 'WHATSAPP', 'INSTAGRAM'] as const).map((c) => (
              <button
                className={canal === c ? 'chip on' : 'chip'}
                key={c || 'todos'}
                onClick={() => setCanal(c)}
                type="button"
              >
                {c === '' ? 'Todos' : c === 'WHATSAPP' ? 'WhatsApp' : 'Instagram'}
              </button>
            ))}
          </div>
        </div>

        <ul className="inbox-items">
          {lista?.conversas.map((c) => (
            <li key={c.id}>
              <button
                aria-current={ativaId === c.id ? 'true' : undefined}
                className={['inbox-item', ativaId === c.id ? 'on' : '', c.nao_lidas ? 'unread' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => void abrir(c.id)}
                type="button"
              >
                <span className={`avatar ${c.canal.toLowerCase()}`} aria-hidden>
                  {nomeDe(c).replace(/^[+@]/, '').charAt(0).toUpperCase()}
                </span>
                <span className="inbox-item-main">
                  <span className="inbox-item-top">
                    <strong>{nomeDe(c)}</strong>
                    <small>{quandoCurto(c.ultima_mensagem_em)}</small>
                  </span>
                  <span className="inbox-item-bottom">
                    <span className="preview">{c.ultima_mensagem_previa ?? '—'}</span>
                    {c.nao_lidas > 0 && <b className="unread-badge">{c.nao_lidas}</b>}
                  </span>
                  <span className="inbox-item-tags">
                    <em className={`canal-tag ${c.canal.toLowerCase()}`}>
                      {c.canal === 'WHATSAPP' ? 'WhatsApp' : 'Instagram'}
                    </em>
                    {c.referral?.adId && <em className="canal-tag ad">Anúncio</em>}
                    {c.unidade && (
                      <em className="unit-tag">
                        <i style={{ background: c.unidade_cor ?? '#587276' }} />
                        {c.unidade}
                      </em>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {lista && !lista.conversas.length && (
            <li className="hint inbox-empty">
              Nenhuma conversa aqui.
              {simulado && ' Use "Simular contato" abaixo para criar uma.'}
            </li>
          )}
        </ul>

        {simulado && (
          <details className="sim-box">
            <summary>Simular contato</summary>
            <form onSubmit={simularContato}>
              <input name="telefone" placeholder="Telefone com DDD (81 98765-4321)" required />
              <input name="nome" placeholder="Nome no WhatsApp" />
              <textarea name="texto" placeholder="Mensagem do cliente" required rows={2} />
              <input name="adId" placeholder="ID do anúncio (opcional)" pattern="\d{5,25}" />
              <input name="anuncioTitulo" placeholder="Título do anúncio (opcional)" />
              <button className="button button-small" type="submit">
                Receber mensagem
              </button>
            </form>
          </details>
        )}
      </aside>

      {/* ------------------------------------------------ Conversa ativa */}
      <section className="inbox-chat" aria-label="Conversa">
        {!conversa ? (
          <div className="inbox-placeholder">
            <p className="eyebrow">Central de Atendimento</p>
            <p className="hint">Escolha uma conversa para responder.</p>
          </div>
        ) : (
          <>
            <header className="chat-head">
              <button className="chat-back" onClick={() => setAtivaId(null)} type="button" aria-label="Voltar">
                ←
              </button>
              <span className={`avatar ${conversa.canal.toLowerCase()}`} aria-hidden>
                {nomeDe(conversa).replace(/^[+@]/, '').charAt(0).toUpperCase()}
              </span>
              <div className="chat-who">
                <strong>{nomeDe(conversa)}</strong>
                <small>
                  {conversa.canal === 'WHATSAPP' ? conversa.contato_telefone : 'Instagram Direct'}
                  {' · '}
                  {conversa.janela_aberta && conversa.janela_expira_em
                    ? `janela aberta até ${new Date(conversa.janela_expira_em).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}`
                    : 'janela de 24h fechada'}
                </small>
              </div>
              <select
                aria-label="Situação da conversa"
                onChange={(e) => void mudarStatus(e.target.value as StatusConversa)}
                value={conversa.status}
              >
                <option value="ABERTA">Aberta</option>
                <option value="PENDENTE">Pendente</option>
                <option value="RESOLVIDA">Resolvida</option>
              </select>
            </header>

            <div className="chat-body">
              {mensagens.map((m) => {
                const dia = new Date(m.em).toDateString();
                const separador = dia !== diaAnterior;
                diaAnterior = dia;
                return (
                  <div key={m.id}>
                    {separador && <p className="chat-day">{rotuloDia(m.em)}</p>}
                    <div
                      className={`bubble ${m.direcao === 'SAIDA' ? 'out' : 'in'} ${m.status === 'FALHOU' ? 'failed' : ''} ${m.gerada_por_ia ? 'ia' : ''}`}
                    >
                      {m.gerada_por_ia && <span className="bubble-ia">🤖 Agente IA</span>}
                      <Midia m={m} />
                      {m.corpo && <p>{m.corpo}</p>}
                      <span className="bubble-meta">
                        {m.direcao === 'SAIDA' && m.autor && <span>{m.autor.split(' ')[0]} · </span>}
                        {hora(m.em)}
                        {m.direcao === 'SAIDA' && <Ticks status={m.status} />}
                      </span>
                      {m.status === 'FALHOU' && m.erro && <small className="bubble-error">{m.erro}</small>}
                    </div>
                  </div>
                );
              })}
              <div ref={fimRef} />
            </div>

            <form className="composer" onSubmit={aoEnviar}>
              {janelaFechada ? (
                <div className="composer-template">
                  <p className="hint">
                    Passaram 24h desde a última mensagem do cliente. O{' '}
                    {conversa.canal === 'WHATSAPP' ? 'WhatsApp' : 'Instagram'} só aceita{' '}
                    {conversa.canal === 'WHATSAPP'
                      ? 'um modelo aprovado no Gerenciador do WhatsApp.'
                      : 'nova mensagem quando o cliente escrever de novo.'}
                  </p>
                  {conversa.canal === 'WHATSAPP' && (
                    <div className="composer-row">
                      <input
                        aria-label="Nome do modelo"
                        onChange={(e) => setModelo((m) => ({ ...m, nome: e.target.value }))}
                        placeholder="nome_do_modelo"
                        value={modelo.nome}
                      />
                      <input
                        aria-label="Idioma do modelo"
                        className="short"
                        onChange={(e) => setModelo((m) => ({ ...m, idioma: e.target.value }))}
                        value={modelo.idioma}
                      />
                      <button className="button button-small" disabled={enviando} type="submit">
                        Enviar modelo
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {anexo && (
                    <div className="composer-attachment">
                      <span>
                        {anexo.tipo === 'PDF' ? '📄' : anexo.tipo === 'VIDEO' ? '🎬' : anexo.tipo === 'IMAGEM' ? '📷' : '📎'}{' '}
                        {anexo.midiaNomeArquivo ?? anexo.midiaUrl}
                      </span>
                      <button className="text-button quiet" onClick={() => setAnexo(null)} type="button">
                        remover
                      </button>
                    </div>
                  )}
                  <div className="composer-row">
                    <button
                      aria-label="Anexar arquivo (PDF, foto ou vídeo até 4 MB)"
                      className="icon-button"
                      disabled={enviando}
                      onClick={() => arquivoRef.current?.click()}
                      title="Anexar arquivo (até 4 MB)"
                      type="button"
                    >
                      📎
                    </button>
                    <input
                      accept="application/pdf,image/jpeg,image/png,image/webp,video/mp4"
                      hidden
                      onChange={(e) => void aoEscolherArquivo(e)}
                      ref={arquivoRef}
                      type="file"
                    />
                    <textarea
                      aria-label="Mensagem"
                      onChange={(e) => setTexto(e.target.value)}
                      onKeyDown={aoDigitar}
                      placeholder={anexo ? 'Legenda (opcional)' : 'Escreva uma mensagem'}
                      rows={1}
                      value={texto}
                    />
                    <button className="button button-small" disabled={enviando || (!texto.trim() && !anexo)} type="submit">
                      {enviando ? '...' : 'Enviar'}
                    </button>
                  </div>
                  {modo?.agente && modo.agente !== 'DESLIGADO' && (
                    <div className="composer-ia">
                      <button
                        className="chip"
                        disabled={sugerindo || enviando}
                        onClick={() => void sugerir()}
                        title="O agente de IA escreve um rascunho; você revisa antes de enviar"
                        type="button"
                      >
                        {sugerindo ? 'Pensando…' : '✨ Sugerir resposta'}
                      </button>
                      {modo.agente === 'AUTOMATICO' && conversa.ia_pausada && (
                        <span className="hint">Agente pausado nesta conversa.</span>
                      )}
                    </div>
                  )}
                  <details className="composer-url">
                    <summary>Mídia por link (vídeo do flat, PDF hospedado)</summary>
                    <div className="composer-row">
                      <select aria-label="Tipo de mídia" onChange={(e) => setTipoUrl(e.target.value)} value={tipoUrl}>
                        <option value="VIDEO">Vídeo</option>
                        <option value="IMAGEM">Imagem</option>
                        <option value="PDF">PDF</option>
                      </select>
                      <input
                        aria-label="URL pública da mídia"
                        onChange={(e) => setUrlMidia(e.target.value)}
                        placeholder="https://..."
                        value={urlMidia}
                      />
                      <button className="text-button" onClick={anexarUrl} type="button">
                        Anexar
                      </button>
                    </div>
                  </details>
                </>
              )}
            </form>
          </>
        )}
        {aviso && (
          <p className="feedback inbox-feedback" role="status">
            {aviso}
          </p>
        )}
      </section>

      {/* ------------------------------------------------ Ficha do lead/reserva */}
      <aside className="inbox-side" aria-label="Lead e reserva">
        {!conversa ? null : (
          <>
            <section>
              <h2>Lead</h2>
              {detalhe?.lead ? (
                <dl className="facts stacked">
                  <div>
                    <dt>Nome</dt>
                    <dd>{detalhe.lead.name}</dd>
                  </div>
                  <div>
                    <dt>Estágio</dt>
                    <dd>{CRM_STAGE[detalhe.lead.stage] ?? detalhe.lead.stage}</dd>
                  </div>
                  <div>
                    <dt>Contato</dt>
                    <dd>{[detalhe.lead.phone, detalhe.lead.email].filter(Boolean).join(' · ') || '—'}</dd>
                  </div>
                  {detalhe.lead.next_action && (
                    <div>
                      <dt>Próxima ação</dt>
                      <dd>{detalhe.lead.next_action}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="hint">Sem lead vinculado.</p>
              )}
            </section>

            <section>
              <h2>Origem</h2>
              {detalhe?.lead ? (
                <dl className="facts stacked">
                  <div>
                    <dt>Canal</dt>
                    <dd>{ORIGEM_CANAL[detalhe.lead.origem_canal ?? ''] ?? 'Não identificado'}</dd>
                  </div>
                  {(detalhe.lead.ad_id || conversa.referral?.adId) && (
                    <div>
                      <dt>Anúncio</dt>
                      <dd>
                        {detalhe.lead.ad_name ?? conversa.referral?.headline ?? 'Ainda não sincronizado'}
                        <small className="mono">#{detalhe.lead.ad_id ?? conversa.referral?.adId}</small>
                      </dd>
                    </div>
                  )}
                  {detalhe.lead.campaign_name && (
                    <div>
                      <dt>Campanha</dt>
                      <dd>
                        {detalhe.lead.campaign_name}
                        {detalhe.lead.adset_name && <small>{detalhe.lead.adset_name}</small>}
                      </dd>
                    </div>
                  )}
                  {(detalhe.lead.utm_source || detalhe.lead.utm_campaign) && (
                    <div>
                      <dt>UTM</dt>
                      <dd className="mono">
                        {[detalhe.lead.utm_source, detalhe.lead.utm_medium, detalhe.lead.utm_campaign, detalhe.lead.utm_content]
                          .filter(Boolean)
                          .join(' / ')}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="hint">—</p>
              )}
            </section>

            <section>
              <h2>Reserva</h2>
              {detalhe?.reserva ? (
                <div className="side-reserva" style={{ borderLeftColor: detalhe.reserva.unidade_cor ?? '#587276' }}>
                  <strong>{detalhe.reserva.unidade}</strong>
                  <span>
                    {shortDate(detalhe.reserva.check_in)} → {shortDate(detalhe.reserva.check_out)} ·{' '}
                    {detalhe.reserva.guest_count} hósp.
                  </span>
                  <span>
                    {STATUS_LABEL[detalhe.reserva.status] ?? detalhe.reserva.status} ·{' '}
                    {PAYMENT_LABEL[detalhe.reserva.payment_status] ?? detalhe.reserva.payment_status}
                  </span>
                  <span>
                    Total {brl(detalhe.reserva.total_amount)} · sinal {brl(detalhe.reserva.deposit_amount)}
                  </span>
                  <span>{detalhe.reserva.contrato_assinado ? 'Contrato assinado' : 'Contrato não assinado'}</span>
                  <Link className="link" href="/admin/agenda">
                    Ver na agenda
                  </Link>
                </div>
              ) : (
                <p className="hint">Nenhuma reserva ligada a esta conversa.</p>
              )}
            </section>

            {modo?.agente === 'AUTOMATICO' && (
              <section className="side-ia">
                <h2>Agente de IA</h2>
                <span>
                  {conversa.ia_pausada
                    ? 'Pausado: só a equipe responde aqui.'
                    : `Respondendo sozinho (${conversa.ia_respostas} resposta(s) até agora).`}
                </span>
                <button className="chip" onClick={() => void alternarIa(!conversa.ia_pausada)} type="button">
                  {conversa.ia_pausada ? 'Retomar agente' : 'Pausar agente'}
                </button>
              </section>
            )}

            <section>
              <Link className="link" href="/admin/crm">
                Abrir o CRM
              </Link>
            </section>

            {simulado && conversa.canal === 'WHATSAPP' && (
              <section className="sim-box open">
                <h2>Simulador</h2>
                <form onSubmit={simularResposta}>
                  <textarea name="texto" placeholder="Resposta do cliente" rows={2} />
                  <button className="button button-small" type="submit">
                    Cliente responde
                  </button>
                </form>
                {ultimaSaida && (
                  <div className="sim-actions">
                    <span className="hint">Última enviada:</span>
                    <button
                      className="chip"
                      onClick={() => void simular({ acao: 'status', mensagemId: ultimaSaida.id, status: 'delivered' })}
                      type="button"
                    >
                      Entregue
                    </button>
                    <button
                      className="chip"
                      onClick={() => void simular({ acao: 'status', mensagemId: ultimaSaida.id, status: 'read' })}
                      type="button"
                    >
                      Lida
                    </button>
                    <button
                      className="chip"
                      onClick={() => void simular({ acao: 'status', mensagemId: ultimaSaida.id, status: 'failed' })}
                      type="button"
                    >
                      Falhou
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
