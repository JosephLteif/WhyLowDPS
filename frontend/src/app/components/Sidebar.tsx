'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { APP_VERSION_WITH_PREFIX } from '../lib/version';

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
    href: '/',
    label: 'Dashboard',
    description: 'Overview of sims, activity, and results.',
    icon: 'M2.5 8L8 3.5 13.5 8M4.5 7.3V12.5h7V7.3',
    matchPaths: ['/'],
  },
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
    matchPaths: ['/drop-finder', '/upgrade-compare', '/upgrade'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder', description: 'Sim raid & dungeon loot' },
      { href: '/upgrade/trinkets', label: 'Trinkets', description: 'Sim trinket pools & pairs' },
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
  {
    href: '/dungeons',
    label: 'Dungeons & Routes',
    description: 'M+ dungeons, affixes, and routes.',
    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2v6z',
    matchPaths: ['/dungeons', '/dungeon-routes'],
    children: [
      { href: '/dungeons', label: 'Dungeon Info', description: 'Rotation and affixes' },
      {
        href: '/dungeon-routes',
        label: 'Saved Routes',
        description: 'Dungeon routes for simulation',
      },
    ],
  },
];

const SIDEBAR_COLLAPSED_KEY = 'whylowdps_sidebar_collapsed';
const SIDEBAR_ORDER_KEY = 'whylowdps_sidebar_order';
const SIDEBAR_VISIBLE_KEY = 'whylowdps_sidebar_visible';

function moveLabel(order: string[], source: string, target: string): string[] {
  if (source === target) return order;
  const withoutSource = order.filter((label) => label !== source);
  const targetIdx = withoutSource.indexOf(target);
  if (targetIdx === -1) return withoutSource;
  withoutSource.splice(targetIdx, 0, source);
  return withoutSource;
}

export default function Sidebar() {
  const pathname = usePathname();
  const normalizedPath = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  const [visibleLabels, setVisibleLabels] = useState<string[] | null>(null);
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const dragSourceRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const { user } = useAuth();

  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (user) {
      items.splice(1, 0, {
        href: '/characters',
        label: 'My Characters',
        description: 'View your Battle.net roster.',
        icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        matchPaths: ['/characters'],
      });

      items.push({
        href: '/settings',
        label: 'Settings',
        description: 'API keys and account setup.',
        icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456c.53-.199 1.144.02 1.41.52l1.296 2.247c.266.46.16 1.05-.24 1.411l-1.014.891c-.265.233-.367.618-.266.953.013.045.024.09.033.135a1.275 1.275 0 0 1 0 .524c-.01.045-.02.09-.033.135a1.275 1.275 0 0 1 .266.953l1.014.891c.4.364.506.95.24 1.411l-1.296 2.247c-.266.5-.88.719-1.41.52l-1.217-.456a1.275 1.275 0 0 1-1.075-.124c-.073.044-.146.087-.22.127a1.275 1.275 0 0 1-.645.87l-.213 1.282c-.09.542-.56.94-1.11.94h-2.592a1.275 1.275 0 0 1-1.11-.94l-.213-1.281a1.275 1.275 0 0 1-.645-.87c-.074-.04-.147-.083-.22-.127a1.275 1.275 0 0 1-1.075-.124l-1.217.456c-.53.199-1.144-.02-1.41-.52l-1.296-2.247c-.266-.46-.16-1.05.24-1.411l1.014-.891c.265-.233.367-.618.266-.953a1.275 1.275 0 0 1-.033-.135 1.275 1.275 0 0 1 0-.524 1.275 1.275 0 0 1 .033-.135 1.275 1.275 0 0 1-.266-.953l-1.014-.891c-.4-.364-.506-.95-.24-1.411l1.296-2.247c.266-.5.88-.719 1.41-.52l1.217.456c.355.133.751.072 1.075-.124.074-.044.147-.087.22-.127a1.275 1.275 0 0 1 .645-.87l.213-1.282z',
        matchPaths: ['/settings'],
      });
    }
    return items;
  }, [user]);

  const orderedNavItems = useMemo(() => {
    if (!navOrder || navOrder.length === 0) return navItems;
    const byLabel = new Map(navItems.map((item) => [item.label, item]));
    const ordered: NavItem[] = [];
    for (const label of navOrder) {
      const item = byLabel.get(label);
      if (item) {
        ordered.push(item);
        byLabel.delete(label);
      }
    }
    for (const item of navItems) {
      if (byLabel.has(item.label)) ordered.push(item);
    }
    return ordered;
  }, [navItems, navOrder]);

  const visibleNavItems = useMemo(() => {
    if (!visibleLabels || visibleLabels.length === 0) return orderedNavItems;
    const visibleSet = new Set(visibleLabels);
    return orderedNavItems.filter((item) => visibleSet.has(item.label));
  }, [orderedNavItems, visibleLabels]);

  const addableNavItems = useMemo(() => {
    const currentVisible =
      visibleLabels && visibleLabels.length > 0
        ? visibleLabels
        : orderedNavItems.map((i) => i.label);
    const visibleSet = new Set(currentVisible);
    return orderedNavItems.filter((item) => !visibleSet.has(item.label));
  }, [orderedNavItems, visibleLabels]);

  useEffect(() => {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    setIsCollapsed(collapsed === '1');
    const savedOrder = localStorage.getItem(SIDEBAR_ORDER_KEY);
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed)) {
          setNavOrder(parsed.filter((v) => typeof v === 'string'));
        }
      } catch {
        // ignore malformed stored order
      }
    }
    const savedVisible = localStorage.getItem(SIDEBAR_VISIBLE_KEY);
    if (savedVisible) {
      try {
        const parsed = JSON.parse(savedVisible);
        if (Array.isArray(parsed)) {
          setVisibleLabels(parsed.filter((v) => typeof v === 'string'));
        }
      } catch {
        // ignore malformed stored visibility
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', isCollapsed ? '5rem' : '18rem');
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed ? '1' : '0');
  }, [isCollapsed]);

  useEffect(() => {
    if (!navOrder) return;
    localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(navOrder));
  }, [navOrder]);

  useEffect(() => {
    if (!visibleLabels) return;
    localStorage.setItem(SIDEBAR_VISIBLE_KEY, JSON.stringify(visibleLabels));
  }, [visibleLabels]);

  useEffect(() => {
    setNavOrder((prev) => {
      const labels = navItems.map((item) => item.label);
      if (!prev || prev.length === 0) return labels;
      const deduped = prev.filter((label, idx) => prev.indexOf(label) === idx);
      const filtered = deduped.filter((label) => labels.includes(label));
      for (const label of labels) {
        if (!filtered.includes(label)) filtered.push(label);
      }
      return filtered;
    });
  }, [navItems]);

  useEffect(() => {
    setVisibleLabels((prev) => {
      const labels = navItems.map((item) => item.label);
      if (!prev || prev.length === 0) return labels;
      const deduped = prev.filter((label, idx) => prev.indexOf(label) === idx);
      const filtered = deduped.filter((label) => labels.includes(label));
      return filtered.length > 0 ? filtered : labels;
    });
  }, [navItems]);

  useEffect(() => {
    dragOverRef.current = dragOverLabel;
  }, [dragOverLabel]);

  const finishPointerDrag = useCallback(() => {
    const source = dragSourceRef.current;
    const target = dragOverRef.current;
    if (source && target && source !== target) {
      setNavOrder((prev) => moveLabel(prev ?? orderedNavItems.map((i) => i.label), source, target));
    }
    dragSourceRef.current = null;
    setDraggingLabel(null);
    setDragOverLabel(null);
  }, [orderedNavItems]);

  useEffect(() => {
    if (!draggingLabel) return;
    const onPointerUp = () => finishPointerDrag();
    const onPointerCancel = () => finishPointerDrag();
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [draggingLabel, finishPointerDrag]);

  return (
    <aside
      className={`fixed bottom-0 left-0 top-14 z-40 flex flex-col justify-between border-r border-border bg-surface/70 pb-4 pt-3 transition-all duration-200 ${isCollapsed ? 'w-20' : 'w-72'}`}
    >
      <nav className={`flex min-h-0 flex-1 flex-col px-4 ${draggingLabel ? 'select-none' : ''}`}>
        {!isCollapsed && (
          <div className={`mb-1 flex items-center gap-2 ${isEditMode ? 'justify-between' : 'justify-end'}`}>
            {isEditMode && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAddMenu((v) => !v)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-sm font-semibold leading-none text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
                  title="Add sidebar section"
                  aria-label="Add sidebar section"
                >
                  +
                </button>
                {showAddMenu && (
                  <div className="absolute left-0 z-50 mt-1 w-max min-w-44 max-w-[calc(100vw-2rem)] rounded-md border border-white/10 bg-[#111218] p-1 shadow-xl">
                    {addableNavItems.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-zinc-500">No sections to add</div>
                    ) : (
                      addableNavItems.map((addItem) => (
                        <button
                          key={`add-${addItem.label}`}
                          type="button"
                          onClick={() => {
                            setVisibleLabels((prev) => {
                              const current =
                                prev && prev.length > 0
                                  ? prev
                                  : orderedNavItems.map((i) => i.label);
                              if (current.includes(addItem.label)) return current;
                              return [...current, addItem.label];
                            });
                            setShowAddMenu(false);
                          }}
                          className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/10"
                        >
                          {addItem.label}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setIsEditMode((v) => !v);
                setShowAddMenu(false);
              }}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                isEditMode
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1] hover:text-white'
              }`}
              title={isEditMode ? 'Finish sidebar edit mode' : 'Edit sidebar'}
              aria-label={isEditMode ? 'Finish sidebar edit mode' : 'Edit sidebar'}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.5 2.5l2 2L6 12H4v-2l7.5-7.5z" />
                <path d="M10 4l2 2" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 space-y-2 overflow-y-auto pb-2">
          {visibleNavItems.map((item) => {
            const isActive = item.matchPaths.some(
              (p) => pathname === p || pathname.startsWith(p + '/')
            );
            const hasChildren = item.children && item.children.length > 0;
            const isOpen = openMenu === item.label || isActive;

            return (
              <div
                key={item.label}
                data-nav-label={item.label}
                className={`flex flex-col gap-1 rounded-lg transition-all duration-150 ${
                  dragOverLabel === item.label && draggingLabel !== item.label
                    ? 'scale-[1.01] bg-gold/[0.06] ring-1 ring-gold/40'
                    : ''
                }`}
                onPointerEnter={() => {
                  if (draggingLabel && draggingLabel !== item.label) {
                    setDragOverLabel(item.label);
                  }
                }}
              >
                <div className="flex items-stretch gap-1">
                  {isEditMode && !isCollapsed && (
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        if (!isEditMode) return;
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        e.preventDefault();
                        dragSourceRef.current = item.label;
                        setDraggingLabel(item.label);
                        setDragOverLabel(item.label);
                      }}
                      className={`shrink-0 cursor-grab rounded-md px-2 text-zinc-600 transition-all hover:bg-white/5 hover:text-zinc-300 active:cursor-grabbing ${
                        draggingLabel === item.label ? 'bg-gold/10 text-gold' : ''
                      }`}
                      title={`Drag to reorder ${item.label}`}
                      aria-label={`Drag to reorder ${item.label}`}
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                        <circle cx="5" cy="4" r="1.1" />
                        <circle cx="11" cy="4" r="1.1" />
                        <circle cx="5" cy="8" r="1.1" />
                        <circle cx="11" cy="8" r="1.1" />
                        <circle cx="5" cy="12" r="1.1" />
                        <circle cx="11" cy="12" r="1.1" />
                      </svg>
                    </button>
                  )}
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      if (isEditMode) {
                        e.preventDefault();
                        return;
                      }
                      const normalizedHref =
                        item.href.endsWith('/') && item.href !== '/' ? item.href.slice(0, -1) : item.href;
                      if (normalizedPath === normalizedHref) {
                        e.preventDefault();
                        window.scrollTo(0, 0);
                        return;
                      }
                      if (hasChildren) setOpenMenu(isOpen ? null : item.label);
                    }}
                    draggable={false}
                    className={`group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 transition-all duration-150 ${
                      draggingLabel === item.label ? 'scale-[0.98] opacity-65 shadow-lg' : ''
                    } ${
                      isActive
                        ? 'bg-gold/15 text-gold'
                        : 'text-zinc-200 hover:bg-surface-2 hover:text-white'
                    }`}
                    title={item.label}
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
                    {!isCollapsed && (
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[15px] font-medium">{item.label}</span>
                        <span
                          className={`text-[13px] leading-snug ${isActive ? 'text-gold/80' : 'text-zinc-300'}`}
                        >
                          {item.description}
                        </span>
                      </div>
                    )}
                  </Link>
                  {isEditMode && !isCollapsed && (
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleLabels((prev) => {
                          const current =
                            prev && prev.length > 0 ? prev : orderedNavItems.map((i) => i.label);
                          if (current.length <= 1) return current;
                          return current.filter((label) => label !== item.label);
                        })
                      }
                      className="shrink-0 rounded-md px-2 text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-300"
                      title={`Remove ${item.label} from sidebar`}
                      aria-label={`Remove ${item.label} from sidebar`}
                    >
                      -
                    </button>
                  )}
                </div>
                {hasChildren && isOpen && !isCollapsed && (
                  <div className="ml-10 flex flex-col border-l-2 border-border/50 pl-2">
                    {item.children!.map((child) => {
                      const childActive =
                        pathname === child.href || pathname.startsWith(child.href + '/');
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={(e) => {
                            const normalizedHref =
                              child.href.endsWith('/') && child.href !== '/'
                                ? child.href.slice(0, -1)
                                : child.href;
                            if (normalizedPath === normalizedHref) {
                              e.preventDefault();
                              window.scrollTo(0, 0);
                            }
                          }}
                          className={`flex flex-col rounded-md px-3 py-2 transition-colors ${
                            childActive
                              ? 'text-gold'
                              : 'text-zinc-200 hover:bg-surface-2 hover:text-white'
                          }`}
                        >
                          <span className="text-[15px] font-medium">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 mb-2 flex items-end justify-end">
          <button
            type="button"
            onClick={() => setIsCollapsed((v) => !v)}
            className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '>>' : '<<'}
          </button>
        </div>
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border/50 px-4 pt-4">
        <div className="mt-2 px-2 text-center text-xs text-zinc-400">
          {!isCollapsed ? APP_VERSION_WITH_PREFIX : 'v'}
        </div>
      </div>
    </aside>
  );
}
