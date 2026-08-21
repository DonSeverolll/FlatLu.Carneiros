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
      await api<{ user: UserDto }>('/api/auth/login', {
        method: 'POST',
        body: { email: data.get('email'), password: data.get('password') }
      });
      router.push('/conta');
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
          E-mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
        {message && <p className="feedback">{message}</p>}
        <p className="hint">
          Ainda não tem conta? <Link href="/cadastro">Criar conta</Link>
        </p>
      </form>
    </main>
  );
}
