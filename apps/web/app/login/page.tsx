'use client';

import { FormEvent, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function LoginPage() {
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: data.get('email'), password: data.get('password') })
    });
    if (response.ok) window.location.href = '/conta';
    else setMessage('E-mail ou senha inválidos.');
  }

  return <main className="account login-page">
    <a className="back-link" href="/">← Voltar</a>
    <p className="eyebrow">Área do hóspede</p>
    <h1>Entre para continuar.</h1>
    <form className="panel login-panel" onSubmit={submit}>
      <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
      <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="button" type="submit">Entrar</button>
      {message && <p className="feedback">{message}</p>}
    </form>
  </main>;
}
