import React from 'react';

export interface SkeletonProps {
  height?: string | number;
  width?: string | number;
  borderRadius?: string;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  height = '1.25rem',
  width = '100%',
  borderRadius = 'var(--radius-sm)',
  count = 1,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height,
            width,
            borderRadius,
            backgroundColor: 'var(--bg-surface-elevated)',
            backgroundImage:
              'linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0) 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
      ))}
    </div>
  );
};
