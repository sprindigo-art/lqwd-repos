import { LayoutDashboard, Users, Cable, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  activePage: 'dashboard' | 'agents' | 'channels';
  onNavigate: (page: 'dashboard' | 'agents' | 'channels') => void;
  onLogout: () => void;
}

const navItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'agents' as const, label: 'Agents', icon: Users },
  { id: 'channels' as const, label: 'Channels', icon: Cable },
];

export function Sidebar({ activePage, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-screen flex-col',
        'w-[220px] lg:w-[220px] md:w-14 max-md:hidden',
        'bg-[var(--card)] border-r border-[var(--border)]'
      )}
    >
      {/* Logo */}
      <div className="px-4 pt-6 pb-4">
        <h1
          className="text-2xl font-semibold md:max-lg:text-center"
          style={{ color: 'var(--primary)' }}
        >
          <span className="lg:inline md:max-lg:hidden">LQWD</span>
          <span className="hidden md:max-lg:inline text-base">L</span>
        </h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'flex h-12 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors',
                'md:max-lg:justify-center md:max-lg:px-0',
                isActive
                  ? 'border-l-[3px] border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]'
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="lg:inline md:max-lg:sr-only">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Sign Out */}
      <div className="border-t border-[var(--border)] p-4 md:max-lg:px-2">
        <button
          onClick={onLogout}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors',
            'md:max-lg:justify-center md:max-lg:px-0',
            'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="lg:inline md:max-lg:sr-only">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
