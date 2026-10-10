import type { Metadata } from 'next';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/unbounded';
import './globals.css';
import { NavLink } from '@/components/NavLink';
import { LiveCodeCoach } from '@/components/LiveCodeCoach';
import { db } from '@/lib/db';
import { getDueCount } from '@/lib/queries';
import { getStreak } from '@/lib/activity';
import { getCardCounts } from '@/lib/cards';
import { getDueLevelCount } from '@/lib/levels';

export const metadata: Metadata = { title: 'Learn it. Keep it.' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [dueCount, inboxCount, streak, cards, dueLevels, openTasks] = await Promise.all([
    getDueCount(),
    db.parkingItem.count({ where: { doneAt: null } }),
    getStreak(),
    getCardCounts(),
    getDueLevelCount(),
    db.task.count({ where: { repeat: 'ONCE', doneAt: null } }),
  ]);

  return (
    <html lang="uk">
      <body>
        <div className="app">
          <aside className="sidebar">
            <div className="sidebar-title">
              Learn it. Keep it.
              <span className="faint mono" style={{ marginLeft: 'auto', fontWeight: 400 }} title="Днів поспіль">{streak.current} дн.</span>
            </div>
            <NavLink href="/" label="Today" count={dueCount} />
            <NavLink href="/cards" label="Cards" count={cards.due + cards.fresh} />
            <NavLink href="/parking" label="Parking" count={inboxCount} />
            <NavLink href="/tasks" label="Tasks" count={openTasks} />
            <div className="sidebar-section">Material</div>
            <NavLink href="/map" label="Map" />
            <NavLink href="/patterns" label="Patterns" />
            <NavLink href="/minimum" label="Minimum" />
            <NavLink href="/reference" label="Reference" />
            <div className="sidebar-section">Knowledge</div>
            <NavLink href="/topics" label="Topics" />
            <NavLink href="/questions" label="Questions" />
            <NavLink href="/plan" label="Plan" />
            <NavLink href="/cycles" label="Cycles" />
            <NavLink href="/stats" label="Stats" />
            <NavLink href="/sources" label="Sources" />
            <div className="sidebar-section">Practice</div>
            <NavLink href="/levels" label="Levels" count={dueLevels} />
            <LiveCodeCoach />
            <NavLink href="/mock" label="Mock interview" />
            <div className="sidebar-section">System</div>
            <NavLink href="/guide" label="Guide" />
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
