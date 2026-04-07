'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import SettingsPopover from './SettingsPopover';
import packageJson from '../../../package.json';
import { useAuth } from './AuthContext';

interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: string;
  matchPaths: string[];
  children?: { href: string; label: string; description: string }[];
}

const baseNavItems: NavItem[] = [
  {
    href: '/quick-sim',
    label: 'Quick Sim',
    description: 'DPS, ability breakdown, stat weights.',
    icon: 'M13 8l-5 5-5-5M3 3h10',
    matchPaths: ['/quick-sim'],
  },
  {
    href: '/stat-weights',
    label: 'Stat Weights',
    description: 'Find stat scaling curves.',
    icon: 'M4 8V6a6 6 0 1 1 12 0v2m1-2a7 7 0 1 1-14 0m7 7v4M8 11.232v4.5A4.5 4.5 0 0 0 12.5 11.232H3.5a4.5 4.5 0 0 0 4.5 4.5',
    matchPaths: ['/stat-weights'],
  },
  {
    href: '/top-gear',
    label: 'Top Gear',
    description: 'Find the best gear from your bags.',
    icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
    matchPaths: ['/top-gear'],
  },
  {
    href: '/drop-finder',
    label: 'Upgrades',
    description: 'Find and sim gear upgrades.',
    icon: 'M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5L14 14',
    matchPaths: ['/drop-finder', '/upgrade-compare'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder', description: 'Sim raid & dungeon loot' },
      { href: '/upgrade-compare', label: 'Crest Upgrades', description: 'Best Dawncrest path' },
    ],
  },
  {
    href: '/history',
    label: 'History',
    description: 'View recent simulation results.',
    icon: 'M8 8m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M8 4.5V8l2.5 2.5',
    matchPaths: ['/history'],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const { user } = useAuth();

  const navItems = [...baseNavItems];
  if (user) {
    navItems.splice(1, 0, {
      href: '/characters',
      label: 'My Characters',
      description: 'View your Battle.net roster.',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      matchPaths: ['/characters'],
    });

    navItems.push({
      href: '/settings',
      label: 'Settings',
      description: 'API keys and account setup.',
      icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456c.53-.199 1.144.02 1.41.52l1.296 2.247c.266.46.16 1.05-.24 1.411l-1.014.891c-.265.233-.367.618-.266.953.013.045.024.09.033.135a1.275 1.275 0 0 1 0 .524c-.01.045-.02.09-.033.135a1.275 1.275 0 0 1 .266.953l1.014.891c.4.364.506.95.24 1.411l-1.296 2.247c-.266.5-.88.719-1.41.52l-1.217-.456a1.275 1.275 0 0 1-1.075-.124c-.073.044-.146.087-.22.127a1.275 1.275 0 0 1-.645.87l-.213 1.282c-.09.542-.56.94-1.11.94h-2.592a1.275 1.275 0 0 1-1.11-.94l-.213-1.281a1.275 1.275 0 0 1-.645-.87c-.074-.04-.147-.083-.22-.127a1.275 1.275 0 0 1-1.075-.124l-1.217.456c-.53.199-1.144-.02-1.41-.52l-1.296-2.247c-.266-.46-.16-1.05.24-1.411l1.014-.891c.265-.233.367-.618.266-.953a1.275 1.275 0 0 1-.033-.135 1.275 1.275 0 0 1 0-.524 1.275 1.275 0 0 1 .033-.135 1.275 1.275 0 0 1-.266-.953l-1.014-.891c-.4-.364-.506-.95-.24-1.411l1.296-2.247c.266-.5.88-.719 1.41-.52l1.217.456c.355.133.751.072 1.075-.124.074-.044.147-.087.22-.127a1.275 1.275 0 0 1 .645-.87l.213-1.282z',
      matchPaths: ['/settings'],
    });
  }

  return (
    <aside className="fixed bottom-0 left-0 top-14 z-40 w-72 border-r border-border/80 bg-surface/50 pb-6 pt-6 flex flex-col justify-between">
      <nav className="flex flex-col gap-2 px-4 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = item.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
          const hasChildren = item.children && item.children.length > 0;
          const isOpen = openMenu === item.label || isActive;

          return (
            <div key={item.label} className="flex flex-col gap-1">
              <Link
                href={item.href}
                onClick={() => hasChildren && setOpenMenu(isOpen ? null : item.label)}
                className={`group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  isActive
                    ? 'bg-gold/10 text-gold'
                    : 'text-zinc-400 hover:bg-surface-2 hover:text-white'
                }`}
              >
                <svg
                  className={`h-5 w-5 shrink-0 ${isActive ? 'text-gold' : 'text-zinc-500 group-hover:text-zinc-300'}`}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                <div className="flex flex-col">
                  <span className="text-[15px] font-medium">{item.label}</span>
                  <span className={`text-[12px] ${isActive ? 'text-gold/70' : 'text-zinc-500'}`}>
                    {item.description}
                  </span>
                </div>
              </Link>
              {hasChildren && isOpen && (
                <div className="ml-10 flex flex-col border-l-2 border-border/50 pl-2">
                  {item.children!.map((child) => {
                    const childActive =
                      pathname === child.href || pathname.startsWith(child.href + '/');
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex flex-col rounded-md px-3 py-2 transition-colors ${
                          childActive
                            ? 'text-gold'
                            : 'text-zinc-400 hover:bg-surface-2 hover:text-white'
                        }`}
                      >
                        <span className="text-[14px] font-medium">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      
      <div className="mt-auto flex flex-col px-4 pt-4 border-t border-border/50 gap-2">
        <SettingsPopover />
        <div className="text-center text-[11px] text-zinc-600 px-2 mt-2">
          v{packageJson.version}
        </div>
      </div>
    </aside>
  );
}
