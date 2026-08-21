'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/api';
import type { UserDto } from '@/lib/types';

const MIN_PASSWORD = 12;

/**
 * O endpoint de cadastro existia desde o início, mas não havia tela: só era
 * possível criar conta via curl. Sem esta página o fluxo de reserva era
 * inalcançável para um hóspede novo.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');

    if (password.length < MIN_PASSWORD) {
      setMessage(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== data.get('passwordConfirmation')) {
      setMessage('As senhas não conferem.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      await api<{ user: UserDto }>('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: data.get('fullName'),
          email: data.get('email'),
          phone: data.get('phone') || undefined,
          password
        }
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
      <h1>Crie sua conta.</h1>
      <form className="panel login-panel" onSubmit={submit}>
        <label>
          Nome completo
          <input name="fullName" required minLength={3} maxLength={160} autoComplete="name" />
        </label>
        <label>
          E-mail
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Telefone (opcional)
          <input name="phone" type="tel" maxLength={32} autoComplete="tel" />
        </label>
        <label>
          Senha
          <input
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
          />
        </label>
        <label>
          Repita a senha
          <input
            name="passwordConfirmation"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
          />
        </label>
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? 'Criando...' : 'Criar conta'}
        </button>
        {message && <p className="feedback">{message}</p>}
        <p className="hint">
          Já tem conta? <Link href="/login">Entrar</Link>
        </p>
      </form>
    </main>
  );
}
