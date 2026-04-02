import { LucideIcon } from 'lucide-react';

export interface Agent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  icon?: LucideIcon;
  iconUrl?: string;
  statusColor: 'green' | 'yellow' | 'red';
  color: string;
  gradient: string;
  avatar?: string;
  link?: string;
}
