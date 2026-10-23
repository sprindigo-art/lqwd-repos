import { useState } from 'react';
import { adminFetch } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { DashboardPage } from '@/components/dashboard/DashboardPage';
import { AgentsPage } from '@/components/agents/AgentsPage';
import { ChannelsPage } from '@/components/channels/ChannelsPage';

interface MainLayoutProps {
  onLogout: () => void;
}

export function MainLayout({ onLogout }: MainLayoutProps) {
  const [activePage, setActivePage] = useState<'dashboard' | 'agents' | 'channels'>('dashboard');

  async function handleLogout() {
    try {
      await adminFetch('/logout', { method: 'POST' });
    } catch {
      // Clear cookies client-side regardless
    }
    document.cookie = 'session=; path=/admin/; max-age=0';
    document.cookie = 'csrf_token=; path=/admin/; max-age=0';
    onLogout();
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        onLogout={handleLogout}
      />

      {/* Main content area */}
      <main className="ml-0 w-full max-w-[1200px] p-8 md:ml-14 lg:ml-[220px]">
        {activePage === 'dashboard' ? (
          <DashboardPage />
        ) : activePage === 'agents' ? (
          <AgentsPage />
        ) : (
          <ChannelsPage />
        )}
      </main>
    </div>
  );
}
