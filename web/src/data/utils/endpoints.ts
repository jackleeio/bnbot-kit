export const API_ENDPOINTS = {
  PRODUCTS: '/products',
  CATEGORIES: '/categories',
  SHOPS: '/shops',
  ORDERS: '/orders',
  USERS: '/users',
  LOGIN: '/token',
  SETTINGS: '/settings',
  MARKETS: '/markets',
  PRICING: '/pricing',
  // PRICING: 'https://api.coingecko.com/api/v3/coins',
  // MARKETS: 'https://api.coingecko.com/api/v3/coins/markets',

  // Stripe Subscription
  STRIPE_CREATE_CHECKOUT: '/api/v1/payments/stripe/create-checkout-session',
  STRIPE_SUBSCRIPTION: '/api/v1/payments/stripe/subscription',
  STRIPE_CREATE_PORTAL: '/api/v1/payments/stripe/create-portal-session',
  STRIPE_SESSION_STATUS: '/api/v1/payments/stripe/session-status',
  CREDITS: '/api/v1/payments/credits',
};
