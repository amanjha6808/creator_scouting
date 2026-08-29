'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Database,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';

const navItems = [
  { href: '/campaigns', label: 'Campaigns', icon: LayoutGrid },
  { href: '/benchmarks', label: 'Benchmarks', icon: Database },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  /* ── Desktop sidebar ─────────────────────────────────────────────────────── */
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-zinc-800">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Sparkles className="h-4 w-4 text-indigo-400" />
        </div>
        <span className="text-sm font-semibold text-zinc-100 tracking-tight hidden lg:block">
          Creator Match
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={closeMobile}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-transparent'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-400' : 'text-zinc-500'}`} />
              <span className="hidden lg:block">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-zinc-800">
        <p className="text-[10px] text-zinc-600 hidden lg:block">Creator Match AI</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-[60px] lg:w-[220px] shrink-0 h-screen bg-zinc-950 border-r border-zinc-800 overflow-y-auto">
        {sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-50 h-12 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4">
        <Link href="/campaigns" className="flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-md bg-indigo-500/10 border border-indigo-500/20">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <span className="text-xs font-semibold text-zinc-200 tracking-tight">Creator Match</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-800 transition-colors"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile slide-out menu */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-zinc-950/80 backdrop-blur-sm"
            onClick={closeMobile}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 animate-slide-in-right">
            {sidebarContent}
          </div>
        </>
      )}

      {/* Mobile spacer */}
      <div className="md:hidden h-12 shrink-0" />
    </>
  );
}
