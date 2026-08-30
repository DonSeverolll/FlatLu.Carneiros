'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/api';
import type { UserDto } from '@/lib/types';

/**
 * Dados do hóspede em um lugar só: perfil, foto, qualificação para o contrato
 * e troca de senha.
 *
 * A foto entra por URL. Upload de arquivo exige armazenamento de objetos
 * (Vercel Blob ou o Storage do Supabase), que ainda não está contratado — um
 * campo de upload que não guarda nada seria pior que a ausência dele.
 */
export default function ConfiguracoesView() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [mensagem, setMensagem] = useState('Carregando seus dados...');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await api<{ user: UserDto }>('/api/auth/me');
      setUser(dados.user);
      setMensagem('');
    } catch (error) {
      setMensagem(messageFor(error));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarPerfil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOcupado('perfil');
    try {
      const dados = await api<{ user: UserDto }>('/api/users/me', {
        method: 'PATCH',
        body: {
          fullName: form.get('fullName'),
          phone: String(form.get('phone') ?? '') || null,
          avatarUrl: String(form.get('avatarUrl') ?? '') || null
        }
      });
      setUser(dados.user);
      setMensagem('Perfil atualizado.');
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function salvarQualificacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setOcupado('qualificacao');
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
      setMensagem('Dados do contrato salvos.');
      await carregar();
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  async function trocarSenha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nova = String(form.get('newPassword') ?? '');
    if (nova !== form.get('confirm')) {
      setMensagem('As senhas não conferem.');
      return;
    }
    setOcupado('senha');
    try {
      const resultado = await api<{ revokedSessions: number }>('/api/auth/password', {
        method: 'POST',
        body: { currentPassword: form.get('currentPassword'), newPassword: nova }
      });
      (event.target as HTMLFormElement).reset();
      setMensagem(
        `Senha alterada. ${resultado.revokedSessions} outro(s) dispositivo(s) foram desconectados.`
      );
    } catch (error) {
      setMensagem(messageFor(error));
    } finally {
      setOcupado(null);
    }
  }

  if (!user) {
    return (
      <>
        <header className="admin-head">
          <div>
            <p className="eyebrow">Minha conta</p>
            <h1>Configurações.</h1>
          </div>
        </header>
        <p className="feedback">{mensagem}</p>
      </>
    );
  }

  const faltaQualificacao = !user.document_number || !user.rg || !user.address_line;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Configurações.</h1>
        </div>
      </header>

      {faltaQualificacao && (
        <p className="feedback">
          Complete os dados do contrato abaixo — sem eles não é possível emitir o contrato de
          locação nem finalizar uma reserva.
        </p>
      )}

      <div className="account-grid">
        <form className="panel" onSubmit={salvarPerfil}>
          <h2>Perfil</h2>
          <div className="photo-row">
            <span className="avatar large">
              {user.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={user.avatar_url} />
              ) : (
                user.full_name.slice(0, 1).toUpperCase()
              )}
            </span>
            <label>
              Foto (endereço da imagem)
              <input
                name="avatarUrl"
                type="url"
                defaultValue={user.avatar_url ?? ''}
                placeholder="https://..."
              />
            </label>
          </div>
          <label>
            Nome completo
            <input name="fullName" defaultValue={user.full_name} required minLength={3} />
          </label>
          <label>
            E-mail
            <input value={user.email} disabled />
          </label>
          <label>
            Telefone
            <input name="phone" defaultValue={user.phone ?? ''} maxLength={32} />
          </label>
          <button className="button" type="submit" disabled={ocupado === 'perfil'}>
            {ocupado === 'perfil' ? 'Salvando...' : 'Salvar perfil'}
          </button>
          <p className="hint">
            A foto é lida de um endereço na internet. Upload direto de arquivo depende de
            armazenamento contratado — sem ele, o campo aceitaria a imagem e não guardaria nada.
          </p>
        </form>

        <form className="panel" onSubmit={trocarSenha}>
          <h2>Senha</h2>
          <label>
            Senha atual
            <input name="currentPassword" type="password" required autoComplete="current-password" />
          </label>
          <label>
            Nova senha
            <input name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
          </label>
          <label>
            Repita a nova senha
            <input name="confirm" type="password" required minLength={12} autoComplete="new-password" />
          </label>
          <button className="button" type="submit" disabled={ocupado === 'senha'}>
            {ocupado === 'senha' ? 'Alterando...' : 'Alterar senha'}
          </button>
          <p className="hint">
            Mínimo de 12 caracteres. Trocar a senha desconecta os outros dispositivos — este
            continua conectado.
          </p>
        </form>
      </div>

      <form className="panel" onSubmit={salvarQualificacao}>
        <h2>Dados do contrato</h2>
        <p className="hint">
          O contrato de locação por temporada exige qualificação completa das partes. Estes dados
          entram no instrumento e não são usados para mais nada.
        </p>
        <div className="rate-grid">
          <label>
            Nome completo
            <input name="fullName" defaultValue={user.full_name} required minLength={3} />
          </label>
          <label>
            CPF
            <input name="documentNumber" defaultValue={user.document_number ?? ''} required minLength={11} />
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
        <button className="button" type="submit" disabled={ocupado === 'qualificacao'}>
          {ocupado === 'qualificacao' ? 'Salvando...' : 'Salvar dados do contrato'}
        </button>
      </form>

      {mensagem && (
        <p className="feedback" role="status">
          {mensagem}
        </p>
      )}
    </>
  );
}
