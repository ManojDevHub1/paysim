import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange }) => {
  return (
    <div className="tabs-header">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon && <span style={{ marginRight: '6px' }}>{tab.icon}</span>}
          {tab.label}
          {tab.badge !== undefined && (
            <span
              style={{
                marginLeft: '8px',
                padding: '1px 6px',
                fontSize: '0.6875rem',
                borderRadius: '9999px',
                backgroundColor: activeTab === tab.id ? 'var(--color-primary-subtle)' : 'var(--bg-surface-elevated)',
                color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--text-muted)',
              }}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
