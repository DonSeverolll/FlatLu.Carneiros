'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageFor } from '@/lib/api';
import { brl, longDate } from '@/lib/format';
import type { PaymentIntentDto, UserDto } from '@/lib/types';

type EstadoContrato = {
  missingCustomerData: string[];
  propertyReady: boolean;
  contractStatus: string | null;
  signedAt: string | null;
  contract: {
    id: string;
    status: string;
    body: string;
    body_hash: string;
    template_version: string;
    signer_name: string | null;
    signed_at: string | null;
    signature_hash: string | null;
  } | null;
};

type Passo = 'dados' | 'contrato' | 'pagamento';

/**
 * Fluxo da reserva depois do aceite dos termos: qualificação, contrato
 * assinado e só então pagamento.
 *
 * A ordem não é estética — é a do próprio instrumento, cuja Cláusula Quarta
 * condiciona a reserva à aprovação da entrada. O servidor recusa cobrança sem
 * contrato assinado; esta tela apenas não deixa o hóspede bater na parede.
 */
export default function ReservaPage({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = use(params);
  const [estado, setEstado] = useState<EstadoContrato | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);
  const [passo, setPasso] = useState<Passo>('dados');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [metodo, setMetodo] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [parcelas, setParcelas] = useState(1);
  const [formas, setFormas] = useState<{ pix: boolean; card: boolean } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [contrato, perfil, metodos] = await Promise.all([
        api<EstadoContrato>(`/api/reservations/${reservationId}/contract`),
        api<{ user: UserDto }>('/api/auth/me'),
        api<{ pix: boolean; card: boolean }>(`/api/reservations/${reservationId}/payment-methods`)
      ]);
      setEstado(contrato);
      setUser(perfil.user);
      setFormas(metodos);

      if (contrato.missingCustomerData.length) setPasso('dados');
      else if (contrato.contractStatus !== 'SIGNED') setPasso('contrato');
      else setPasso('pagamento');
    } catch (error) {
      setErro(messageFor(error));
    }
  }, [reservationId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O contrato é emitido assim que a qualificação está completa.
  useEffect(() => {
    if (passo !== 'contrato' || !estado || estado.contract) return;
    let ativo = true;
    api<{ contract: EstadoContrato['contract'] }>(`/api/reservations/${reservationId}/contract`, {
      method: 'POST'
    })
      .then((dados) => {
        if (ativo) setEstado((atual) => (atual ? { ...atual, contract: dados.contract, contractStatus: 'AWAITING_SIGNATURE' } : atual));
      })
      .catch((causa) => {
        if (ativo) setErro(messageFor(causa));
      });
    return () => {
      ativo = false;
    };
  }, [passo, estado, reservationId]);

  const gerarCobranca = useCallback(async () => {
    setOcupado('pagamento');
    setErro('');
    try {
      const dados = await api<PaymentIntentDto>(
        `/api/reservations/${reservationId}/payment-intent`,
        { method: 'POST', body: { method: metodo, installments: parcelas, kind: 'DEPOSIT' } }
      );
      setIntent(dados);
      if (dados.card?.checkoutUrl) window.location.href = dados.card.checkoutUrl;
    } catch (error) {
      setErro(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }, [reservationId, metodo, parcelas]);

  useEffect(() => {
    if (passo === 'pagamento' && metodo === 'PIX' && !intent && formas?.pix) void gerarCobranca();
  }, [passo, metodo, intent, formas, gerarCobranca]);

  async function salvarDados(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOcupado('dados');
    setErro('');
    try {
      await api('/api/users/me/qualification', {
        method: 'PUT',
        body: {
          fullName: form.get('fullName'),
          documentNumber: form.get('documentNumber'),
          rg: form.get('rg'),
          rgIssuer: form.get('rgIssuer'),
          nationality: String(form.get('nationality') ?? 'brasileira'),
          profession: form.get('profession'),
          maritalStatus: String(form.get('maritalStatus') ?? '') || undefined,
          addressLine: form.get('addressLine'),
          addressCity: form.get('addressCity'),
          addressState: form.get('addressState'),
          addressZip: form.get('addressZip'),
          phone: String(form.get('phone') ?? '') || undefined
        }
      });
      await carregar();
      setPasso('contrato');
    } catch (error) {
      setErro(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function assinar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOcupado('assinar');
    setErro('');
    try {
      await api(`/api/reservations/${reservationId}/contract/sign`, {
        method: 'POST',
        body: {
          signerName: form.get('signerName'),
          signerCpf: form.get('signerCpf'),
          accepted: true
        }
      });
      await carregar();
      setPasso('pagamento');
    } catch (error) {
      setErro(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function copiarPix() {
    if (!intent?.pix) return;
    try {
      await navigator.clipboard.writeText(intent.pix.payload);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não foi possível copiar. Selecione o código manualmente.');
    }
  }

  if (!estado || !user) {
    return (
      <main className="account guest-area">
        {erro ? <p className="feedback">{erro}</p> : <p>Carregando sua reserva...</p>}
        <Link className="link" href="/conta">
          Minhas reservas
        </Link>
      </main>
    );
  }

  const passos: { id: Passo; rotulo: string }[] = [
    { id: 'dados', rotulo: 'Seus dados' },
    { id: 'contrato', rotulo: 'Contrato' },
    { id: 'pagamento', rotulo: 'Pagamento' }
  ];
  const indiceAtual = passos.findIndex((p) => p.id === passo);

  return (
    <main className="account guest-area">
      <Link className="back-link" href="/conta">
        ← Minhas reservas
      </Link>
      <p className="eyebrow">Reserva</p>
      <h1>
        {passo === 'dados' ? 'Só faltam seus dados.'
          : passo === 'contrato' ? 'Leia e assine o contrato.'
          : 'Falta pouco para confirmar.'}
      </h1>

      <ol className="stepper">
        {passos.map((item, indice) => (
          <li
            className={indice < indiceAtual ? 'done' : indice === indiceAtual ? 'now' : ''}
            key={item.id}
          >
            <span>{indice + 1}</span>
            {item.rotulo}
          </li>
        ))}
      </ol>

      {erro && <p className="feedback">{erro}</p>}

      {/* ---------------------------------------------------- passo 1 */}
      {passo === 'dados' && (
        <form className="panel" onSubmit={salvarDados}>
          <h2>Qualificação para o contrato</h2>
          <p className="hint">
            O contrato de locação por temporada identifica as partes por nome, RG, CPF e endereço.
            Estes dados entram no instrumento e não são usados para mais nada.
          </p>
          <div className="rate-grid">
            <label>
              Nome completo
              <input name="fullName" defaultValue={user.full_name} required minLength={3} />
            </label>
            <label>
              CPF
              <input name="documentNumber" defaultValue={user.document_number ?? ''} required minLength={11} placeholder="000.000.000-00" />
            </label>
            <label>
              RG
              <input name="rg" defaultValue={user.rg ?? ''} required minLength={3} />
            </label>
            <label>
              Órgão emissor
              <input name="rgIssuer" defaultValue={user.rg_issuer ?? ''} required placeholder="SDS/PE" />
            </label>
            <label>
              Nacionalidade
              <input name="nationality" defaultValue={user.nationality ?? 'brasileira'} required />
            </label>
            <label>
              Estado civil
              <input name="maritalStatus" defaultValue={user.marital_status ?? ''} placeholder="opcional" />
            </label>
            <label>
              Profissão
              <input name="profession" defaultValue={user.profession ?? ''} required minLength={2} />
            </label>
            <label>
              Telefone
              <input name="phone" defaultValue={user.phone ?? ''} maxLength={32} />
            </label>
          </div>
          <label>
            Endereço (rua, número, complemento, bairro)
            <input name="addressLine" defaultValue={user.address_line ?? ''} required minLength={5} />
          </label>
          <div className="rate-grid">
            <label>
              Cidade
              <input name="addressCity" defaultValue={user.address_city ?? ''} required minLength={2} />
            </label>
            <label>
              UF
              <input name="addressState" defaultValue={user.address_state ?? ''} required maxLength={2} placeholder="PE" />
            </label>
            <label>
              CEP
              <input name="addressZip" defaultValue={user.address_zip ?? ''} required minLength={8} placeholder="00000-000" />
            </label>
          </div>
          <button className="button" type="submit" disabled={ocupado === 'dados'}>
            {ocupado === 'dados' ? 'Salvando...' : 'Continuar para o contrato'}
          </button>
        </form>
      )}

      {/* ---------------------------------------------------- passo 2 */}
      {passo === 'contrato' && (
        <>
          {!estado.propertyReady && (
            <p className="feedback">
              O endereço deste espaço ainda não foi cadastrado, então o contrato não pode ser
              emitido. Fale com o anfitrião.
            </p>
          )}
          <section className="panel">
            <h2>Contrato de locação por temporada</h2>
            {estado.contract ? (
              <>
                <pre className="contract-body">{estado.contract.body}</pre>
                <p className="hint">
                  Versão {estado.contract.template_version} · impressão digital do texto{' '}
                  <code>{estado.contract.body_hash.slice(0, 16)}…</code>
                </p>
              </>
            ) : (
              <p>Gerando o contrato...</p>
            )}
          </section>

          {estado.contract && (
            <form className="panel" onSubmit={assinar}>
              <h2>Assinatura</h2>
              <p className="hint">
                Assinatura eletrônica simples, nos termos do art. 4º, I, da Lei 14.063/2020.
                Registramos o seu nome, CPF, endereço IP, data e hora, e a impressão digital do
                texto acima — se qualquer um mudar depois, a conferência não fecha.
                <strong> Não é assinatura ICP-Brasil nem Gov.br.</strong>
              </p>
              <label>
                Digite seu nome completo, como no cadastro
                <input name="signerName" required minLength={3} placeholder={user.full_name} />
              </label>
              <label>
                Digite seu CPF
                <input name="signerCpf" required minLength={11} placeholder="000.000.000-00" />
              </label>
              <button className="button" type="submit" disabled={ocupado === 'assinar'}>
                {ocupado === 'assinar' ? 'Registrando...' : 'Assinar e ir para o pagamento'}
              </button>
            </form>
          )}
        </>
      )}

      {/* ---------------------------------------------------- passo 3 */}
      {passo === 'pagamento' && (
        <>
          {estado.signedAt && (
            <p className="hint">
              Contrato assinado em {new Date(estado.signedAt).toLocaleString('pt-BR')}.{' '}
              <button className="link" type="button" onClick={() => setPasso('contrato')}>
                Rever o contrato
              </button>
            </p>
          )}

          <section className="panel">
            <h2>Como você quer pagar</h2>
            <div className="unit-filter">
              {formas?.pix !== false && (
                <button
                  className={metodo === 'PIX' ? 'unit-tab on' : 'unit-tab'}
                  onClick={() => { setMetodo('PIX'); setIntent(null); }}
                  type="button"
                >
                  Pix
                </button>
              )}
              {formas?.card && (
                <button
                  className={metodo === 'CREDIT_CARD' ? 'unit-tab on' : 'unit-tab'}
                  onClick={() => { setMetodo('CREDIT_CARD'); setIntent(null); }}
                  type="button"
                >
                  Cartão de crédito
                </button>
              )}
            </div>

            {formas && !formas.card && (
              <p className="hint">
                No momento aceitamos apenas Pix. O pagamento com cartão está sendo habilitado.
              </p>
            )}
            {formas && !formas.pix && (
              <p className="feedback">
                O pagamento deste espaço ainda não foi configurado. Fale com o anfitrião para
                combinar a forma de pagamento — sua reserva continua guardada.
              </p>
            )}

            {metodo === 'CREDIT_CARD' && (
              <>
                <label>
                  Parcelas
                  <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button"
                  type="button"
                  onClick={() => void gerarCobranca()}
                  disabled={ocupado === 'pagamento'}
                >
                  {ocupado === 'pagamento' ? 'Abrindo...' : 'Pagar com cartão'}
                </button>
                <p className="hint">
                  Você será levado ao ambiente seguro do provedor. Nenhum dado de cartão passa por
                  este site.
                </p>
              </>
            )}
          </section>

          {metodo === 'PIX' && intent?.pix && (
            <div className="account-grid">
              <section className="panel">
                <h2>Pix</h2>
                <div className="qr-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="QR Code do Pix para pagamento do sinal"
                    src={`/api/reservations/${reservationId}/pix-qr`}
                    width={220}
                    height={220}
                  />
                </div>
                <p className="pix-amount">{brl(intent.reservation.depositAmount)}</p>
                <label>
                  Copia e cola
                  <textarea readOnly rows={4} value={intent.pix.payload} />
                </label>
                <button className="button" type="button" onClick={() => void copiarPix()}>
                  {copiado ? 'Código copiado' : 'Copiar código Pix'}
                </button>
                <dl className="facts">
                  <div>
                    <dt>Favorecido</dt>
                    <dd>{intent.pix.holderName}</dd>
                  </div>
                  <div>
                    <dt>Identificador</dt>
                    <dd>{intent.payment.reference}</dd>
                  </div>
                </dl>
                {intent.pix.instructions && <p className="hint">{intent.pix.instructions}</p>}
              </section>

              <section className="panel">
                <h2>Sua reserva</h2>
                <dl className="facts stacked">
                  <div>
                    <dt>Espaço</dt>
                    <dd>{intent.reservation.unitName}</dd>
                  </div>
                  <div>
                    <dt>Entrada</dt>
                    <dd>{longDate(intent.reservation.checkIn)} a partir das 09:00</dd>
                  </div>
                  <div>
                    <dt>Saída</dt>
                    <dd>{longDate(intent.reservation.checkOut)} até as 16:00</dd>
                  </div>
                  <div>
                    <dt>Total da estadia</dt>
                    <dd>{brl(intent.reservation.totalAmount)}</dd>
                  </div>
                  <div>
                    <dt>Sinal agora</dt>
                    <dd>{brl(intent.reservation.depositAmount)}</dd>
                  </div>
                  <div>
                    <dt>Restante</dt>
                    <dd>
                      {brl(
                        Number(intent.reservation.totalAmount) -
                          Number(intent.reservation.depositAmount)
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="hint">
                  A reserva é confirmada depois que o sinal compensa. Guarde o identificador{' '}
                  <strong>{intent.payment.reference}</strong>: é a referência da conciliação.
                </p>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
