import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
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
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
