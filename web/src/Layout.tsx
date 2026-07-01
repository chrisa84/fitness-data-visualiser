import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import ChatDrawer from './ChatDrawer';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/activities', label: 'Activities' },
  { to: '/volume', label: 'Volume' },
  { to: '/performance', label: 'Performance' },
  { to: '/intensity', label: 'Intensity' },
  { to: '/dynamics', label: 'Dynamics' },
  { to: '/efficiency', label: 'Efficiency' },
  { to: '/load', label: 'Load' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/records', label: 'Records' },
  { to: '/events', label: 'Events' },
  { to: '/intraday', label: 'Intraday' },
  { to: '/planner', label: 'Planner' },
  { to: '/training', label: 'Training' },
  { to: '/chat', label: 'Chat' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header>
        <button
          className="nav-toggle"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <h1>Fitness Data Visualiser</h1>
        <nav className={menuOpen ? 'open' : ''}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="ask-ai" onClick={() => setChatOpen(true)}>
          Ask AI
        </button>
      </header>
      <main>
        <Outlet />
      </main>
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
