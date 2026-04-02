# Invitation System Implementation

I have implemented the frontend portion of the invitation system as requested.

## Changes

### 1. Invitation Code Capture
- Logic moved to `src/app/(modern)/register/page.tsx`
- **Functionality**: 
  - When visiting `/register?code=...`, the code is automatically saved to `localStorage`.
  - If no code is present, redirects to home.
  - Automatically opens the Login Modal.

### 2. Authentication Integration
- Modified `src/components/login/login-modal.tsx`
- **Functionality**: 
  - Checks `localStorage` for an invitation code when the modal opens.
  - Displays a banner "Registering with invitation code: CODE" if present.
  - Sends `invite_code` field in the payload for both Email Login (`/api/v1/email-login`) and Google Login (`/api/v1/google-oauth`).

### 3. "Credits" Page Integration
- Modified `src/app/(modern)/credits/page.tsx`
- **Functionality**:
  - Displays the user's unique invitation link using `bnbot.ai/register?code=...`.
  - Shows invitation stats (invite count, credits earned).
  - Allows copying the link (adds `https://` prefix on copy).

## Verification

### Testing the Flow
1. **Simulate an Invite Link**:
   - Visit `http://localhost:3000/?invite_code=TEST1234`
   - Check `localStorage` in DevTools -> Application -> Local Storage. You should see `invite_code: "TEST1234"`.

2. **Register/Login**:
   - Open the Login Modal.
   - You should see a yellow banner: "Registering with invitation code: TEST1234".
   - Proceed with login. The network request payload should include `"invite_code": "TEST1234"`.

3. **View Stats**:
   - Navigate to `/invitations` (e.g., add a link in the sidebar or visit directly).
   - Ensure you are logged in.
   - You should see your invitation code and stats (assuming the backend endpoints are ready).

## Backend Requirements
Ensure your backend implements the following endpoints as per your description:
- `POST /api/v1/email-login` (accepts `invite_code`)
- `POST /api/v1/google-oauth` (accepts `invite_code`)
- `GET /api/v1/invitations/stats` (returns `{ success: true, invitation_code: "...", total_invitees: 0, total_credits_earned: 0 }`)
