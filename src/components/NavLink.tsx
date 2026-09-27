'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, icon, label, count }: { href: string; icon: string; label: string; count?: number }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link href={href} className={`nav-link ${active ? 'active' : ''}`}>
      <span style={{ width: 20, textAlign: 'center' }}>{icon}</span>
      <span>{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}
