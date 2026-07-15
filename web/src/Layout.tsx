import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import ChatDrawer from './ChatDrawer';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Health',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/intraday', label: 'Intraday' },
      { to: '/events', label: 'Events' },
    ],
  },
  {
    label: 'Activities',
    items: [
      { to: '/activities', label: 'Activities' },
      { to: '/compare', label: 'Compare' },
      { to: '/records', label: 'Records' },
      { to: '/heatmap', label: 'Heatmap' },
      { to: '/routes', label: 'Routes' },
      { to: '/planner', label: 'Planner' },
    ],
  },
  {
    label: 'Trends',
    items: [
      { to: '/volume', label: 'Volume' },
      { to: '/performance', label: 'Performance' },
      { to: '/intensity', label: 'Intensity' },
      { to: '/dynamics', label: 'Dynamics' },
      { to: '/efficiency', label: 'Efficiency' },
      { to: '/load', label: 'Load' },
      { to: '/analysis', label: 'Analysis' },
    ],
  },
  {
    label: 'AI',
    items: [
      { to: '/chat', label: 'Chat' },
      { to: '/training', label: 'Training' },
    ],
  },
  {
    // EXPERIMENTAL — trial features, see EXPERIMENTS.md. Remove entries here
    // (and the group when empty) to retire one.
    label: 'Experimental',
    items: [{ to: '/experimental/fitness-trend', label: 'Fitness trend' }],
  },
];

function groupIsActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );
}

export default function Layout() {
  const [chatOpen, setChatOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { pathname } = useLocation();

  const groupLinks = (onNavigate: () => void) =>
    NAV_GROUPS.map((group) => (
      <div className="nav-section" key={group.label}>
        <span className="nav-section-label">{group.label}</span>
        {group.items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate}>
            {item.label}
          </NavLink>
        ))}
      </div>
    ));

  return (
    <>
      <header>
        <h1>Fitness Data Visualiser</h1>
        {/* Desktop: grouped dropdown nav (hover/focus opens a group's menu). */}
        <nav>
          {NAV_GROUPS.map((group) => (
            <div
              className={`nav-group${groupIsActive(group, pathname) ? ' active' : ''}`}
              key={group.label}
            >
              <button className="nav-group-btn" type="button">
                {group.label} <span aria-hidden>▾</span>
              </button>
              <div className="nav-menu">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <button className="ask-ai" onClick={() => setChatOpen(true)}>
          Ask AI
        </button>
      </header>
      <main>
        <Outlet />
      </main>

      {/* Mobile: fixed bottom tab bar; "More" opens a grouped sheet. */}
      <nav className="tabbar">
        <NavLink to="/" end onClick={() => setSheetOpen(false)}>
          Home
        </NavLink>
        <NavLink to="/activities" onClick={() => setSheetOpen(false)}>
          Activities
        </NavLink>
        <NavLink to="/chat" onClick={() => setSheetOpen(false)}>
          Chat
        </NavLink>
        <button
          type="button"
          className={sheetOpen ? 'active' : ''}
          onClick={() => setSheetOpen((v) => !v)}
        >
          More
        </button>
      </nav>
      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="nav-sheet" onClick={(e) => e.stopPropagation()}>
            {groupLinks(() => setSheetOpen(false))}
            <div className="nav-section">
              <NavLink to="/settings" onClick={() => setSheetOpen(false)}>
                Settings
              </NavLink>
            </div>
          </div>
        </div>
      )}

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
