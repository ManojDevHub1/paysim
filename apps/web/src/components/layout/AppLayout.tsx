import React from 'react';
import { Sidebar, type ViewType } from './Sidebar.js';
import { Header } from './Header.js';

interface AppLayoutProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  activeView,
  onNavigate,
  children,
}) => {
  return (
    <div className="app-layout">
      <Sidebar activeView={activeView} onNavigate={onNavigate} />
      <div className="app-main">
        <Header activeView={activeView} />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
};
