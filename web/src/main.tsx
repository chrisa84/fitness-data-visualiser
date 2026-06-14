import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Layout from './Layout';
import Activities from './pages/Activities';
import ActivityDetail from './pages/ActivityDetail';
import Analysis from './pages/Analysis';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Efficiency from './pages/Efficiency';
import Events from './pages/Events';
import Intensity from './pages/Intensity';
import Performance from './pages/Performance';
import Records from './pages/Records';
import RunningDynamics from './pages/RunningDynamics';
import Volume from './pages/Volume';
import './styles.css';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/activities', element: <Activities /> },
      { path: '/activities/:id', element: <ActivityDetail /> },
      { path: '/volume', element: <Volume /> },
      { path: '/performance', element: <Performance /> },
      { path: '/intensity', element: <Intensity /> },
      { path: '/dynamics', element: <RunningDynamics /> },
      { path: '/efficiency', element: <Efficiency /> },
      { path: '/analysis', element: <Analysis /> },
      { path: '/records', element: <Records /> },
      { path: '/events', element: <Events /> },
      { path: '/chat', element: <Chat /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
