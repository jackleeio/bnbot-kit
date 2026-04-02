# Privacy Policy for X-Sidekick: BNBot AI

**Last Updated: January 31, 2026**

## Introduction

X-Sidekick: BNBot AI ("we", "our", or "the Extension") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our Chrome extension.

## Information We Collect

### 1. Google Account Information
When you sign in using Google OAuth, we receive:
- Your Google account email address
- Your display name
- Your profile picture URL

This information is used solely for authentication and personalization within the extension.

### 2. Twitter/X Page Content and API Data
The extension reads content from Twitter/X pages you visit to provide its core features. This includes:

**DOM Content Reading:**
- Tweet text, author information, and engagement metrics visible on the page
- Tweet IDs extracted from page URLs and elements

**Twitter API Response Interception (Read-Only):**
To provide accurate exposure predictions and analytics, the extension intercepts Twitter's internal API responses to access:
- Follower counts and account metrics
- Tweet engagement data (likes, retweets, replies, views)
- Account verification status

**Important:**
- This interception is **read-only** - we do not modify any Twitter requests or responses
- All data is processed **locally in your browser** for feature calculations
- **We do not store or transmit your Twitter/X browsing history or API data to external servers**
- Data is cached temporarily in browser memory and cleared when you close the tab

### 3. Boost Campaign Detection
When the "Money Vision" feature is enabled, the extension:
- Extracts tweet IDs from your timeline
- Sends these IDs to our server to check for active boost campaigns
- Displays visual indicators on tweets with active campaigns

**Note:** Only tweet IDs are sent - no personal data, tweet content, or browsing history is transmitted.

### 4. Local Storage Data
We store the following data locally in your browser:
- Your login session information
- User preferences and settings
- Chat history with the AI assistant
- Credits balance

## How We Use Your Information

- **Authentication**: To verify your identity and provide personalized features
- **AI Features**: To analyze tweets and generate helpful responses using AI
- **Exposure Prediction**: To calculate estimated comment exposure using follower counts and engagement metrics (processed locally)
- **Boost Detection**: To identify tweets with active promotional campaigns
- **Credits System**: To track your usage of AI features

## Data Processing Location

| Data Type | Processing Location | Transmitted to Server |
|-----------|--------------------|-----------------------|
| Twitter API data (followers, metrics) | Local browser only | ❌ No |
| Tweet content for AI analysis | Server (when you use AI features) | ✅ Yes (with consent) |
| Tweet IDs for boost detection | Server | ✅ Yes (IDs only) |
| User preferences | Local browser only | ❌ No |

## Third-Party Services

### AI Services
We use AI services to power our chat and analysis features. When you use these features, the content you submit is processed by AI services. You initiate this by actively using the chat or analysis features.

### Google OAuth
We use Google OAuth for secure authentication. Your Google credentials are never stored by our extension.

### Boost Campaign API
We operate our own API server to check for active boost campaigns. Only tweet IDs are sent to this server - no personal information or tweet content is transmitted.

## Data Security

- All authentication is handled through secure Google OAuth
- We do not store your passwords
- Local data is stored using Chrome's secure storage API
- We do not sell or share your personal information with third parties

## Data Retention

- Session data is retained until you log out
- Chat history is stored locally and can be cleared at any time
- You can remove all extension data by uninstalling the extension

## Your Rights

You have the right to:
- Access the personal information we hold about you
- Request deletion of your data by uninstalling the extension
- Opt out of using the extension at any time

## Children's Privacy

This extension is not intended for use by children under 13 years of age. We do not knowingly collect personal information from children.

## Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date at the top of this policy.

## Contact Us

If you have any questions about this Privacy Policy, please contact us at:

**Email**: uxk970524@gmail.com

---

*This extension is not affiliated with Twitter/X or Google. Twitter and X are trademarks of X Corp. Google is a trademark of Google LLC.*
