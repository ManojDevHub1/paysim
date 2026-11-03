import React from 'react';
import { Badge, type BadgeVariant } from '../ui/Badge.js';

export interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let variant: BadgeVariant = 'neutral';
  const s = status.toLowerCase();

  switch (s) {
    case 'paid':
    case 'captured':
    case 'delivered':
    case 'succeeded':
    case 'enabled':
    case 'success':
    case 'resolved_success':
      variant = 'success';
      break;

    case 'pending':
    case 'queued':
    case 'retry_scheduled':
    case 'attempted':
    case 'created':
    case 'authorized':
      variant = 'warning';
      break;

    case 'in_progress':
      variant = 'info';
      break;

    case 'failed':
    case 'cancelled':
    case 'exhausted':
    case 'rejected':
    case 'interrupted':
    case 'redirect_rejected':
    case 'disabled':
    case 'resolved_failed':
      variant = 'danger';
      break;

    case 'native':
    case 'compatibility':
      variant = 'info';
      break;

    default:
      variant = 'neutral';
  }

  return <Badge variant={variant}>{status.toUpperCase()}</Badge>;
};
