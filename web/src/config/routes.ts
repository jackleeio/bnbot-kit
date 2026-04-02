import { homedir } from "os";

const routes = {
  home: '/',
  agent: '/agent',
  create: '/task/create',
  message: '/message',
  boost: '/boost',
  balance: '/balance',
  transfer: '/xMoney',
  airdrop: '/airdrop',
  fans: '/fans',
  xMoney: '/xMoney',
  asset: '/asset',
  search: '/search',
  notification: '/notifications',
  vote: '/vote',
  charts: '/charts',
  profile: '/profile',
  portfolio: '/profile?view=portfolio',
  history: '/profile?view=history',
  classic: '/classic',
  coinDetails: '/coin-details',
  signIn: '/authentication',
  signUp: '/authentication/sign-up',
  handle: '/:handle',
  xInsight: '/xInsight',
  credits: '/credits',
  futureCredits: '/future-credits',
};

export default routes;
