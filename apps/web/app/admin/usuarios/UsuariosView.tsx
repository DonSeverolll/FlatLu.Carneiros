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

export default function UsuariosView() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [papel, setPapel] = useState<'' | 'ADMIN' | 'CUSTOMER'>('');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ id: string; senha: string } | null>(null);
  const [mensagem, setMensagem] = useState('Carregando usuários...');
  const [ocupado, setOcupado] = useState<string | null>(null);

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

  async function redefinirSenha(usuario: Usuario) {
    const senha = sugerirSenha();
    const confirmado = window.confirm(
      `Definir uma senha nova para ${usuario.full_name}?\n\n` +
        `A senha aparecerá na tela para você repassar. Todas as sessões dessa pessoa ` +
        `serão encerradas.`
    );
    if (!confirmado) return;

    setOcupado(usuario.id);
    try {
      const resultado = await api<{ revokedSessions: number }>(
        `/api/admin/users/${usuario.id}/password`,
        { method: 'POST', body: { newPassword: senha } }
      );
      setSenhaGerada({ id: usuario.id, senha });
      setMensagem(
        `Senha redefinida. ${resultado.revokedSessions} sessão(ões) encerrada(s). ` +
          `Copie agora: ela não é exibida de novo.`
      );
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
                    {usuario.role === 'ADMIN' ? 'Administrador' : 'Cliente'}
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
                    className="text-button"
                    disabled={ocupado === usuario.id}
                    onClick={() => void redefinirSenha(usuario)}
                    type="button"
                  >
                    Redefinir senha
                  </button>
                </span>
              </div>

              {senhaGerada?.id === usuario.id && (
                <p className="password-reveal">
                  Senha nova de {usuario.full_name}: <code>{senhaGerada.senha}</code>
                  <button
                    className="text-button"
                    onClick={() => void navigator.clipboard.writeText(senhaGerada.senha)}
                    type="button"
                  >
                    Copiar
                  </button>
                </p>
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
