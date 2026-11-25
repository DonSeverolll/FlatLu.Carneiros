'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';

type Usuario = {
  id: string;
  full_name: string;
  username: string | null;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'CUSTOMER';
  /** Só vem preenchido para a conta Dev. */
  is_dev?: boolean;
  status: string;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
  sessoes_ativas: string;
  reservas: string;
};

/** Senha sugerida sem caracteres ambíguos, para ditar por telefone sem erro. */
function sugerirSenha(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => alfabeto[n % alfabeto.length]).join('');
}

const MIN_SENHA = 12;

/**
 * Definir a próxima senha de uma conta.
 *
 * - Outra pessoa: o admin escolhe a senha (ou pede uma sugestão) e todas as
 *   sessões dela caem — ela entra de novo já com a senha nova.
 * - A própria conta: exige a senha atual e mantém esta sessão aberta; as
 *   outras sessões caem.
 */
function FormularioSenha({
  usuario,
  propria,
  onConcluir,
  onCancelar
}: {
  usuario: Usuario;
  propria: boolean;
  onConcluir: (mensagem: string) => void;
  onCancelar: () => void;
}) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const curta = nova.length > 0 && nova.length < MIN_SENHA;
  const diferente = repetida.length > 0 && repetida !== nova;
  const pronta =
    nova.length >= MIN_SENHA && repetida === nova && (!propria || atual.length > 0) && !enviando;

  function gerar() {
    const sugestao = sugerirSenha();
    setNova(sugestao);
    setRepetida(sugestao);
    setMostrar(true);
    setErro('');
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pronta) return;
    if (propria && atual === nova) {
      setErro('A senha nova precisa ser diferente da atual.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      const resultado = propria
        ? await api<{ revokedSessions: number }>('/api/auth/password', {
            method: 'POST',
            body: { currentPassword: atual, newPassword: nova }
          })
        : await api<{ revokedSessions: number }>(`/api/admin/users/${usuario.id}/password`, {
            method: 'POST',
            body: { newPassword: nova }
          });
      onConcluir(
        propria
          ? `Sua senha foi trocada. Você continua conectado aqui; ${resultado.revokedSessions} outra(s) sessão(ões) encerrada(s).`
          : `Senha de ${usuario.full_name} trocada. ${resultado.revokedSessions} sessão(ões) encerrada(s): ` +
              `a pessoa entra de novo com a senha nova.`
      );
    } catch (error) {
      setErro(messageFor(error));
    } finally {
      setEnviando(false);
    }
  }

  const tipo = mostrar ? 'text' : 'password';

  return (
    <form className="user-form password-form" onSubmit={(event) => void enviar(event)}>
      <p className="password-form-title">
        {propria ? 'Trocar a minha senha' : `Próxima senha de ${usuario.full_name}`}
      </p>
      <div className="rate-grid">
        {propria && (
          <label>
            Senha atual
            <input
              autoComplete="current-password"
              onChange={(e) => setAtual(e.target.value)}
              required
              type="password"
              value={atual}
            />
          </label>
        )}
        <label>
          Nova senha
          <input
            aria-invalid={curta || undefined}
            autoComplete="new-password"
            maxLength={200}
            minLength={MIN_SENHA}
            onChange={(e) => setNova(e.target.value)}
            required
            type={tipo}
            value={nova}
          />
          <small className={curta ? 'field-error' : 'hint'}>
            {curta ? `Faltam ${MIN_SENHA - nova.length} caractere(s).` : `Mínimo de ${MIN_SENHA} caracteres.`}
          </small>
        </label>
        <label>
          Repetir a nova senha
          <input
            aria-invalid={diferente || undefined}
            autoComplete="new-password"
            maxLength={200}
            onChange={(e) => setRepetida(e.target.value)}
            required
            type={tipo}
            value={repetida}
          />
          {diferente && <small className="field-error">As duas senhas não são iguais.</small>}
        </label>
      </div>
      <div className="password-form-actions">
        <label className="check-inline">
          <input checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} type="checkbox" />
          Mostrar senha
        </label>
        <button className="text-button" onClick={gerar} type="button">
          Gerar uma sugestão
        </button>
        {mostrar && nova && (
          <button className="text-button" onClick={() => void navigator.clipboard.writeText(nova)} type="button">
            Copiar
          </button>
        )}
      </div>
      {erro && (
        <p className="field-error" role="alert">
          {erro}
        </p>
      )}
      <div className="password-form-actions">
        <button className="button button-small" disabled={!pronta} type="submit">
          {enviando ? 'Salvando...' : 'Salvar senha nova'}
        </button>
        <button className="text-button" onClick={onCancelar} type="button">
          Cancelar
        </button>
      </div>
      <p className="hint">
        {propria
          ? 'Você continua conectado neste aparelho. Nos outros, vai precisar entrar de novo com a senha nova.'
          : 'Todas as sessões dessa pessoa são encerradas na hora. Repasse a senha por um canal seguro.'}
      </p>
    </form>
  );
}

export default function UsuariosView({ souDev = false }: { souDev?: boolean }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [papel, setPapel] = useState<'' | 'ADMIN' | 'CUSTOMER'>('');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [trocandoSenha, setTrocandoSenha] = useState<string | null>(null);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState('Carregando usuários...');
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: { id: string } }>('/api/auth/me')
      .then((dados) => setMeuId(dados.user.id))
      .catch(() => setMeuId(null));
  }, []);

  const carregar = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (papel) params.set('role', papel);
      if (busca.trim()) params.set('search', busca.trim());
      const dados = await api<{ users: Usuario[] }>(`/api/admin/users?${params.toString()}`);
      setUsuarios(dados.users);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, [papel, busca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(usuario: Usuario, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOcupado(usuario.id);
    try {
      await api(`/api/admin/users/${usuario.id}`, {
        method: 'PATCH',
        body: {
          fullName: String(form.get('fullName') ?? ''),
          email: String(form.get('email') ?? ''),
          username: String(form.get('username') ?? '') || null,
          phone: String(form.get('phone') ?? '') || null,
          role: form.get('role'),
          status: form.get('status')
        }
      });
      setMensagem(`${usuario.full_name} atualizado.`);
      setEditando(null);
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }


  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Usuários</p>
          <h1>Quem tem acesso.</h1>
        </div>
        <div className="filter-row">
          <input
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, e-mail ou usuário"
            value={busca}
          />
          <button className={papel === '' ? 'chip on' : 'chip'} onClick={() => setPapel('')} type="button">
            Todos
          </button>
          <button className={papel === 'ADMIN' ? 'chip on' : 'chip'} onClick={() => setPapel('ADMIN')} type="button">
            Administradores
          </button>
          <button className={papel === 'CUSTOMER' ? 'chip on' : 'chip'} onClick={() => setPapel('CUSTOMER')} type="button">
            Clientes
          </button>
        </div>
      </header>

      <section className="panel">
        <h2>{usuarios.length} usuário(s)</h2>
        <div className="customer-list">
          {usuarios.map((usuario) => (
            <div className="user-row" key={usuario.id}>
              <div className="user-summary">
                <span className="avatar" aria-hidden>
                  {usuario.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={usuario.avatar_url} />
                  ) : (
                    usuario.full_name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="customer-main">
                  <strong>{usuario.full_name}</strong>
                  <small>
                    {usuario.email}
                    {usuario.username ? ` · ${usuario.username}` : ''}
                  </small>
                  <small>
                    {usuario.reservas} reserva(s) ·{' '}
                    {usuario.last_login_at
                      ? `último acesso ${new Date(usuario.last_login_at).toLocaleDateString('pt-BR')}`
                      : 'nunca acessou'}
                  </small>
                </span>
                <span className="customer-stats">
                  <em className={usuario.role === 'ADMIN' ? 'tag good' : 'tag'}>
                    {souDev && usuario.is_dev ? 'Dev' : usuario.role === 'ADMIN' ? 'Administrador' : 'Cliente'}
                  </em>
                  {usuario.status !== 'ACTIVE' && <em className="tag bad">{usuario.status}</em>}
                  <small>{usuario.sessoes_ativas} sessão(ões) ativa(s)</small>
                </span>
                <span className="admin-actions">
                  <button
                    className="text-button"
                    onClick={() => setEditando(editando === usuario.id ? null : usuario.id)}
                    type="button"
                  >
                    {editando === usuario.id ? 'Fechar' : 'Configurações'}
                  </button>
                  <button
                    aria-expanded={trocandoSenha === usuario.id}
                    className="text-button"
                    disabled={ocupado === usuario.id}
                    onClick={() => setTrocandoSenha(trocandoSenha === usuario.id ? null : usuario.id)}
                    type="button"
                  >
                    {trocandoSenha === usuario.id
                      ? 'Fechar senha'
                      : usuario.id === meuId
                        ? 'Trocar minha senha'
                        : 'Definir nova senha'}
                  </button>
                </span>
              </div>

              {trocandoSenha === usuario.id && (
                <FormularioSenha
                  key={usuario.id}
                  onCancelar={() => setTrocandoSenha(null)}
                  onConcluir={(texto) => {
                    setTrocandoSenha(null);
                    setMensagem(texto);
                    void carregar();
                  }}
                  propria={usuario.id === meuId}
                  usuario={usuario}
                />
              )}

              {editando === usuario.id && (
                <form className="user-form" onSubmit={(event) => void salvar(usuario, event)}>
                  <div className="rate-grid">
                    <label>
                      Nome
                      <input name="fullName" defaultValue={usuario.full_name} required minLength={3} />
                    </label>
                    <label>
                      E-mail
                      <input name="email" type="email" defaultValue={usuario.email} required />
                    </label>
                    <label>
                      Usuário (login)
                      <input name="username" defaultValue={usuario.username ?? ''} placeholder="opcional" />
                    </label>
                    <label>
                      Telefone
                      <input name="phone" defaultValue={usuario.phone ?? ''} maxLength={32} />
                    </label>
                    <label>
                      Tipo
                      <select name="role" defaultValue={usuario.role}>
                        <option value="CUSTOMER">Cliente</option>
                        <option value="ADMIN">Administrador</option>
                      </select>
                    </label>
                    <label>
                      Situação
                      <select name="status" defaultValue={usuario.status}>
                        <option value="ACTIVE">Ativo</option>
                        <option value="SUSPENDED">Suspenso</option>
                      </select>
                    </label>
                  </div>
                  <button className="button button-small" type="submit" disabled={ocupado === usuario.id}>
                    Salvar
                  </button>
                  <p className="hint">
                    Suspender encerra as sessões da pessoa na hora. Você não consegue rebaixar nem
                    suspender a própria conta — sem essa trava, um clique errado deixaria o sistema
                    sem administrador.
                  </p>
                </form>
              )}
            </div>
          ))}
          {!usuarios.length && <p className="hint">Nenhum usuário encontrado.</p>}
        </div>
      </section>

      {mensagem && (
        <p className="feedback" role="status">
          {mensagem}
        </p>
      )}
    </>
  );
}
