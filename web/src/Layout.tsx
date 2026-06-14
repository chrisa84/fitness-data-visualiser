import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import ChatDrawer from './ChatDrawer';

export default function Layout() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <header>
        <h1>Fitness Data Visualiser</h1>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/activities">Activities</NavLink>
          <NavLink to="/volume">Volume</NavLink>
          <NavLink to="/performance">Performance</NavLink>
          <NavLink to="/intensity">Intensity</NavLink>
          <NavLink to="/dynamics">Dynamics</NavLink>
          <NavLink to="/analysis">Analysis</NavLink>
          <NavLink to="/records">Records</NavLink>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/chat">Chat</NavLink>
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
