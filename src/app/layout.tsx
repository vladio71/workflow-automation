import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { NavLink } from '@/components/NavLink';
import { db } from '@/lib/db';
import { getDueCount } from '@/lib/queries';

export const metadata: Metadata = { title: 'Learn it. Keep it.' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [dueCount, inboxCount] = await Promise.all([getDueCount(), db.inboxItem.count()]);

  return (
    <html lang="en">
      <body>
        <div className="app">
          <aside className="sidebar">
            <div className="sidebar-title">
              <span style={{ fontSize: 18 }}>🧠</span> Learn it. Keep it.
            </div>
            <NavLink href="/" icon="☀️" label="Today" count={dueCount} />
            <NavLink href="/inbox" icon="📥" label="Inbox" count={inboxCount} />
            <div className="sidebar-section">Knowledge</div>
            <NavLink href="/topics" icon="🗂️" label="Topics" />
            <NavLink href="/questions" icon="❓" label="Questions" />
            <NavLink href="/cycles" icon="🔁" label="Cycles" />
            <div className="sidebar-section">Practice</div>
            <NavLink href="/mock" icon="🎙️" label="Mock interview" />
            <div className="sidebar-section">System</div>
            <NavLink href="/guide" icon="📖" label="Guide" />
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
