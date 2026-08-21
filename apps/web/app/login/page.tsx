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
      body: JSON.stringify({ identifier: data.get('identifier'), password: data.get('password') })
    });
    if (response.ok) {
      const result = await response.json();
      window.location.href = result.user.role === 'ADMIN' ? '/admin' : '/conta';
    }
    else setMessage('E-mail ou senha inválidos.');
  }

  return <main className="account login-page">
    <a className="back-link" href="/">← Voltar</a>
    <p className="eyebrow">Área do hóspede</p>
    <h1>Entre para continuar.</h1>
    <form className="panel login-panel" onSubmit={submit}>
      <label>E-mail ou usuário<input name="identifier" autoComplete="username" required /></label>
      <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="button" type="submit">Entrar</button>
      <p className="form-helper">Ainda não tem uma conta? <a href="/cadastro">Cadastre-se</a></p>
      {message && <p className="feedback">{message}</p>}
    </form>
  </main>;
}
