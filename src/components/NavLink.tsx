'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, label, count }: { href: string; label: string; count?: number }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link href={href} className={`nav-link ${active ? 'active' : ''}`}>
      <span>{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </Link>
  );
}
