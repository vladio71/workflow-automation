import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { NavLink } from '@/components/NavLink';
import { db } from '@/lib/db';
import { getDueCount } from '@/lib/queries';
import { getStreak } from '@/lib/activity';
import { getCardCounts } from '@/lib/cards';
import { getDueLevelCount } from '@/lib/levels';

export const metadata: Metadata = { title: 'Learn it. Keep it.' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [dueCount, inboxCount, streak, cards, dueLevels] = await Promise.all([
    getDueCount(),
    db.inboxItem.count(),
    getStreak(),
    getCardCounts(),
    getDueLevelCount(),
  ]);

  return (
    <html lang="en">
      <body>
        <div className="app">
          <aside className="sidebar">
            <div className="sidebar-title">
              <span style={{ fontSize: 18 }}>🧠</span> Learn it. Keep it.
              <span className="faint" style={{ marginLeft: 'auto', fontWeight: 500 }} title="Streak: days in a row">🔥 {streak.current}</span>
            </div>
            <NavLink href="/" icon="☀️" label="Today" count={dueCount} />
            <NavLink href="/cards" icon="🃏" label="Cards" count={cards.due + cards.fresh} />
            <NavLink href="/inbox" icon="📥" label="Inbox" count={inboxCount} />
            <div className="sidebar-section">Knowledge</div>
            <NavLink href="/topics" icon="🗂️" label="Topics" />
            <NavLink href="/questions" icon="❓" label="Questions" />
            <NavLink href="/plan" icon="🧭" label="Plan" />
            <NavLink href="/cycles" icon="🔁" label="Cycles" />
            <NavLink href="/stats" icon="📈" label="Stats" />
            <NavLink href="/sources" icon="🔗" label="Sources" />
            <div className="sidebar-section">Practice</div>
            <NavLink href="/levels" icon="⚔️" label="Levels" count={dueLevels} />
            <NavLink href="/loot" icon="🎁" label="Loot" />
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
