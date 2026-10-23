import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import { LoginForm } from '@/components/login/LoginForm';
import { MainLayout } from '@/components/layout/MainLayout';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if session cookie exists (quick client-side check)
    const hasSession = document.cookie.includes('session=');
    setAuthenticated(hasSession);
    setChecking(false);
  }, []);

  if (checking) return null;

  return (
    <>
      {authenticated ? (
        <MainLayout onLogout={() => setAuthenticated(false)} />
      ) : (
        <LoginForm onSuccess={() => setAuthenticated(true)} />
      )}
      <Toaster />
    </>
  );
}
