# Changelog

## [Unreleased]

### Added
- Boost API client (`lib/boost-api.ts`) with REST API integration (searchBoosts, getBoostDetail, createBoost, getBoostSignature, createBoostCheckout, fetchTweetInfo)
- BoostVault contract ABI and address constants (`contracts/BoostVault.ts`)
- Create Boost page (`boost/create-v2/page.tsx`) with crypto wallet and Stripe payment support
- Boost list page with status filter dropdown (All/Active/Pending/Completed), search, and Masonry grid layout
- Sign in button and wallet connect button in boost page header
- Boost modal for desktop detail view via `showBoostModal` in animated-modal context

### Changed
- Migrated boost list page (`boost/page.tsx`) from Apollo GraphQL (XAsset Subgraph) to REST API (`searchBoosts`)
- Migrated boost detail page (`boost/[id]/page.tsx`) from Apollo GraphQL to REST API (`getBoostDetail`)
- Migrated boost card component (`mini-boost-card.tsx`) from XAsset type to BoostPublic type with real data (budget, participants, countdown, status)
- Migrated boost detail view (`boost-detail-page-view.tsx`) from XAsset + contract reads to BoostPublic with real budget/rewards/countdown
- Migrated boost modal (`boost-modal.tsx`) from XAsset to BoostPublic with live tweet engagement data
- Updated animated-modal context to support `showBoostModal` and `modalBoost` state
- Removed ClassicLayout header from boost pages (`boost/layout.tsx`)
- Aligned create-v2 page params with backend schema (duration_days, token_type, tweet_snapshot, etc.)

### Removed
- Removed duplicate files: `new-boost/` directory, `boost-list-view.tsx`, `boost-detail-view.tsx`, `boost-create-form.tsx`
- Removed Apollo GraphQL and XAsset subgraph dependencies from boost pages
