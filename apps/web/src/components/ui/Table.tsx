import React from 'react';

export interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export const Table: React.FC<TableProps> = ({ children, className = '' }) => {
  return (
    <div className="table-container">
      <table className={`data-table ${className}`.trim()}>{children}</table>
    </div>
  );
};

export const THead: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <thead>{children}</thead>;
};

export const TBody: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <tbody>{children}</tbody>;
};

export const Tr: React.FC<{ children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }> = ({
  children,
  onClick,
  style,
}) => {
  return (
    <tr onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', ...style }}>
      {children}
    </tr>
  );
};

export const Th: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => {
  return <th style={style}>{children}</th>;
};

export const Td: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; colSpan?: number }> = ({
  children,
  style,
  colSpan,
}) => {
  return (
    <td style={style} colSpan={colSpan}>
      {children}
    </td>
  );
};
