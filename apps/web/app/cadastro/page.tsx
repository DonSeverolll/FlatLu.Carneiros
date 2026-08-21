'use client';

import { FormEvent, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function RegisterPage() {
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('Criando sua conta...');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: data.get('fullName'),
          email: data.get('email'),
          password: data.get('password')
        })
      });
      if (response.ok) {
        window.location.href = '/conta';
        return;
      }
      setMessage(response.status === 409 ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar sua conta.');
    } catch {
      setMessage('Não foi possível conectar ao servidor.');
    }
  }

  return <main className="account login-page">
    <a className="back-link" href="/">← Voltar</a>
    <p className="eyebrow">Área do hóspede</p>
    <h1>Crie sua conta.</h1>
    <form className="panel login-panel" onSubmit={submit}>
      <label>Nome completo<input name="fullName" autoComplete="name" required minLength={3} /></label>
      <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
      <label>Senha<input name="password" type="password" autoComplete="new-password" required minLength={12} /></label>
      <button className="button" type="submit">Cadastrar</button>
      <p className="form-helper">Já tem uma conta? <a href="/login">Entrar</a></p>
      {message && <p className="feedback" role="status">{message}</p>}
    </form>
  </main>;
}