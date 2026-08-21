'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import type { UserDto } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage('');
    try {
      // `identifier` aceita e-mail (hóspedes) ou usuário (administradores).
      const { user } = await api<{ user: UserDto }>('/api/auth/login', {
        method: 'POST',
        body: { identifier: data.get('identifier'), password: data.get('password') }
      });
      router.push(user.role === 'ADMIN' ? '/admin' : '/conta');
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="account login-page">
      <Link className="back-link" href="/">
        ← Voltar
      </Link>
      <p className="eyebrow">Área do hóspede</p>
      <h1>Entre para continuar.</h1>
      <form className="panel login-panel" onSubmit={submit}>
        <label>
          E-mail ou usuário
          <input name="identifier" autoComplete="username" required minLength={3} maxLength={320} />
        </label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
        {message && (
          <p className="feedback" role="status">
            {message}
          </p>
        )}
        <p className="form-helper">
          Ainda não tem uma conta? <Link href="/cadastro">Cadastre-se</Link>
        </p>
      </form>
    </main>
  );
}
