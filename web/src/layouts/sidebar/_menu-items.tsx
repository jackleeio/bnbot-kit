import routes from '@/config/routes';
import {
  ChartLine,
  Rocket,
  Bot,
  DollarSign,

} from 'lucide-react';

export const defaultMenuItems = [
  {
    name: 'X Agent',
    icon: <ChartLine size={20} />,
    href: '/chat',
  },
  {
    name: 'X Boost',
    icon: <Rocket size={20} />,
    href: routes.boost,
  },
  {
    name: 'X Plugin',
    icon: <Bot size={20} />,
    href: '/x-agent',
  },
  {
    name: 'X Money',
    icon: <DollarSign size={20} />,
    href: 'https://xmoney.to',
  },

];

export const MinimalMenuItems = [
  {
    name: 'X Agent',
    icon: <ChartLine size={20} />,
    href: '/chat',
  },
  {
    name: 'X Boost',
    icon: <Rocket size={20} />,
    href: routes.boost,
  },
  {
    name: 'X Plugin',
    icon: <Bot size={20} />,
    href: '/x-agent',
  },
  {
    name: 'X Money',
    icon: <DollarSign size={20} />,
    href: 'https://xmoney.to',
  },

];
