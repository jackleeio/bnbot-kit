# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BNBOT (formerly XID) is a Next.js-based crypto AI agent platform built for Web3 interactions. It features AI agents specialized in different areas like crypto analysis, content creation, and social media management, with a focus on the BNB Chain ecosystem.

## Essential Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev             # Start development server on http://localhost:3000
pnpm build           # Build production version
pnpm start           # Start production server
pnpm lint            # Run ESLint
pnpm clean           # Clean node_modules, .next, and cache

# No test commands are configured in this project

# Git push with proxy (run this before git push if network issues occur)
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
```

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 14 with App Router
- **UI**: Tailwind CSS + DaisyUI, Framer Motion for animations
- **State Management**: Jotai for global state
- **Web3**: Wagmi + Reown AppKit for wallet connections
- **Backend Integration**: REST API endpoints for authentication and data
- **Charts**: Recharts for data visualization

### Key App Structure

#### Routing Pattern
The app uses Next.js 13+ app directory structure with a `(modern)` route group:
- Root redirects to `/agent` (configured in next.config.js)
- Main pages: `/agent`, `/chat`, `/boost`, `/balance`, `/task`, `/credits`
- Layout inheritance through `src/app/(modern)/layout.tsx` → ClassicLayout

#### Component Organization
- `src/components/`: Feature-specific components (boost, chat, login, task, profile)
- `src/components/ui/`: Reusable UI components and design system
- `src/layouts/`: Layout components (classic, minimal, header, sidebar)
- `src/lib/hooks/`: Custom React hooks and utilities

#### Web3 Integration
- Configured for BNB Chain (BSC) and BSC Testnet primarily
- Wallet connection through Reown AppKit (formerly WalletConnect)
- Contract interactions in `src/contracts/` directory
- Requires `NEXT_PUBLIC_CRYPTO_PROJECT_ID` environment variable

### State Management Patterns
- Jotai atoms for global state (user auth, UI state)
- React Query for server state management
- Local state for component-specific data

### Authentication System
The app supports multiple authentication methods:
- Email verification with codes
- Google OAuth integration
- X (Twitter) OAuth integration
- Web3 wallet connection

Environment variables required for auth:
- `NEXT_PUBLIC_REST_API_ENDPOINT`: Backend API base URL
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google OAuth client ID
- `NEXT_PUBLIC_CRYPTO_PROJECT_ID`: WalletConnect project ID

### Agent System
Core feature allowing users to interact with specialized AI agents:
- Agent selection page with categories (Finance, Marketing, Meme, etc.)
- Chat interface with agent-specific contexts
- Agent routing: Crypto Intelligence redirects to `/chat`, others use query params

### Design System
- Custom Tailwind theme with crypto/Web3 focused color palette
- Brand color: `#f0b90b` (gold/yellow theme)
- Responsive breakpoints including ultra-wide (up to 4xl: 2160px)
- Custom animations and shadows for premium feel
- Dark mode support through `next-themes`

### Security Considerations
- Security headers configured in next.config.js
- Image domains whitelisted for external sources
- TypeScript and ESLint errors ignored in production builds
- Husky for git hooks

## Development Workflow

1. **Environment Setup**: Copy `.env.local.example` and configure required API endpoints and keys
2. **Wallet Integration**: Ensure `NEXT_PUBLIC_CRYPTO_PROJECT_ID` is set for Web3 functionality
3. **API Integration**: Backend services are expected at `NEXT_PUBLIC_REST_API_ENDPOINT`
4. **Styling**: Use Tailwind classes with the custom theme, avoid hardcoded colors
5. **Components**: Follow the established UI component patterns in `src/components/ui/`
6. **State**: Use Jotai for global state, React Query for server data

## Important Notes

**DO NOT run `pnpm build` after making frontend code changes.** The development server (`pnpm dev`) provides hot reloading and is sufficient for testing changes. Building is only necessary for production deployment.

**Before every git push**, check the BNBOT Extension changelog for version updates:
1. Read `/Users/jacklee/Projects/bnbot-extension-new/CHANGELOG.md`
2. Compare the latest version with `messages/en.json` and `messages/zh.json` `versionInfo` field
3. If there's a newer version, update both files with:
   - New version number and date in `versionInfo`
   - Summarize key new features in one line for `newFeatures`

## Key Configuration Files

- `next.config.js`: Redirects, image domains, security headers, and production build settings
- `tailwind.config.js`: Custom theme, colors, animations, and responsive breakpoints
- `src/config/routes.ts`: Centralized route definitions
- `src/app/shared/wallet-provider.tsx`: Web3 configuration and wallet setup