# Privacy Policy for BNBot

**Last Updated: May 12, 2026**

## Introduction

BNBot ("we", "our", or "the Service") is committed to protecting your
privacy. This Privacy Policy covers the BNBot Chrome extension and
the BNBot desktop application. The Chrome extension does not work on
its own — it is the browser-side helper for the desktop app, and the
two halves are designed to be used together.

## How BNBot works, in plain terms

The desktop app is where you sign in and tell BNBot what to do. The
Chrome extension is a thin executor: when the desktop app asks, the
extension reads pages you are currently viewing or performs an action
you triggered (post a tweet, send a reply, save a bookmark, and so on)
in your own browser session.

The two halves communicate over a local WebSocket on your own machine
(127.0.0.1 / localhost). That channel is never exposed to the public
internet.

## Information We Collect

### 1. Account information (collected by the desktop app)

When you sign in to BNBot from the desktop app, we receive:

- The identifier you signed in with — your BNBot account key (issued
  by api.bnbot.ai) or, if you chose email-OTP login, your email address
- Authentication tokens issued by api.bnbot.ai

The extension does not collect a separate identity. It receives the
same tokens from the desktop app over the local WebSocket described
above, and stores them in Chrome's secure extension storage so it can
authenticate against api.bnbot.ai on your behalf.

### 2. Page content you ask BNBot to look at

When the desktop app asks the extension to look at a page you are
currently viewing on a supported social platform (currently X / Twitter):

- The extension reads the page's DOM and the platform's internal API
  responses (timeline data, profile metrics, engagement data, account
  verification status).
- This is read-only — we never modify the platform's requests or
  responses.
- The desktop agent uses this content to draft replies, summarize
  threads, suggest next actions, and so on.

We do not crawl pages in the background, and we do not record your
browsing history. The extension only interacts with pages relevant to
a task you have actively started in the desktop app.

### 3. Actions you trigger

When you ask the desktop agent to post, reply, like, bookmark, follow,
or perform any other action, the extension carries out that action in
your existing browser session using its `debugger` capability (Chrome
DevTools Protocol). The outcome is sent back to the desktop app so it
can show you what happened.

### 4. Boost campaign detection

The extension can show visual indicators on tweets that have an active
"Money Vision" boost campaign. To do this it:

- Extracts tweet IDs from your timeline
- Sends those IDs to api.bnbot.ai
- Receives back a list of which IDs are currently boosted

Only tweet IDs are transmitted — no tweet content, no author info,
no your-account info.

### 5. Local storage on your device

The extension stores the following in Chrome's `chrome.storage.local`:

- Your BNBot authentication tokens (relayed from the desktop app)
- Your in-extension preferences and panel state

The desktop app keeps its own logs and history on your local disk
inside its application data directory. The extension does not have
access to that data.

## What we do not do

- We do not sell your data, ever.
- We do not train our or anyone else's AI models on your tweets,
  replies, or messages.
- We do not run mass automation campaigns (no auto-like, auto-follow,
  mass DM, or similar). Every action originates from a request you
  made in the desktop app.
- We do not collect or upload your full browsing history. The
  extension only interacts with pages you have explicitly asked the
  desktop app to work on.
- The extension does not function without the BNBot desktop app — it
  is the browser-side helper, not a standalone product.

## Where the data goes

| Data | Where it lives | Sent to api.bnbot.ai? |
|------|----------------|-----------------------|
| Auth tokens | Desktop app and extension's `chrome.storage.local` on your device | Yes — used to authenticate API calls you make |
| Pages BNBot looks at | Read into the desktop agent's working memory while a task is running | Only if you ask the agent to do something that requires our cloud (e.g. AI inference you signed up for) |
| Tweet IDs for boost detection | Sent to api.bnbot.ai for lookup | Yes (IDs only) |
| Preferences / panel state | Local browser only | No |

## Third-party services

- **api.bnbot.ai** — our own backend. Handles authentication, the
  boost-campaign lookup, and (when you opt in) cloud-based AI inference
  for the desktop agent.
- **AI providers** — if your plan uses cloud AI, the content you ask
  BNBot to act on is forwarded by the desktop app to AI providers we
  partner with. The Chrome extension itself does not call any
  third-party AI provider directly.

## Data security

- All API traffic to api.bnbot.ai is over HTTPS.
- Authentication uses tokens issued by api.bnbot.ai; we do not store
  passwords. If you signed up with email-OTP, no password exists in
  the first place.
- Local data uses Chrome's secure storage API.
- The extension ↔ desktop-app channel is bound to localhost and is
  never exposed to the network.

## Data retention

- Auth tokens are kept until you log out from the desktop app, at
  which point they are revoked server-side and cleared from the
  extension.
- Preferences are kept until you uninstall the extension.
- You can remove all extension data at any time by uninstalling the
  extension. To remove desktop data, delete the BNBot app's data
  directory.

## Your rights

You have the right to:

- Access the personal information we hold about you — email
  support@bnbot.ai
- Request deletion of your account and data — email support@bnbot.ai
- Uninstall the extension and the desktop app at any time

## Children's privacy

BNBot is not intended for use by children under 13. We do not
knowingly collect personal information from children.

## Changes to this Policy

We may update this Privacy Policy from time to time. We will notify
you of any changes by updating the "Last Updated" date at the top of
this policy. Material changes will also be announced inside the
BNBot desktop app.

## Contact Us

**Email:** support@bnbot.ai

---

*BNBot is not affiliated with X / Twitter, Google, or any AI provider.
Trademarks are property of their respective owners.*
