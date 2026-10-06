import { useState } from 'react';
import { setToken } from './api/client';
import { Login } from './components/Login';
import { PosScreen } from './components/PosScreen';
import type { Session } from './types';
import './App.css';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  if (!session) return <Login onLogin={setSession} />;
  return <PosScreen session={session} onLogout={() => { setToken(null); setSession(null); }} />;
}
