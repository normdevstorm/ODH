# Auth Login and Refresh TODOs

Track these items alongside the implementation plan in [auth-login-refresh-plan.md](auth-login-refresh-plan.md).

## TODOs
- [ ] Define the auth session model for access token, refresh token, expiry, and login state.
- [ ] Identify the login entry point for the extension and confirm how the auth backend returns tokens.
- [ ] Add secure persistence for auth tokens in the extension storage layer.
- [ ] Update `ServerConnect` to attach the current access token to every learning-service request.
- [ ] Add a single refresh path for expired tokens and retry the failed request once.
- [ ] Handle refresh failure by clearing stale auth data and forcing re-login.
- [ ] Add user-facing messages for login required, refresh success, and refresh failure.
- [ ] Validate the flow against the learning-service `401` response behavior.
- [ ] Document any backend contract assumptions that still need confirmation.

## Notes
- Keep refresh handling centralized so future API calls reuse the same behavior.
- Avoid refresh loops by allowing only one retry per failed request.
- Update this file as implementation tasks are completed.

## Progress
- [x] Added a reusable auth-session helper for access token, refresh token, and expiry state.
- [x] Wired `ServerConnect` to attach auth headers, retry once on `401`, and persist refreshed session data.
- [x] Added shared storage defaults for the new ServerConnect auth fields.
- [x] Implemented login endpoint and logout method in `ServerConnect`.
- [x] Added user-facing login button and status feedback in the options UI.
- [x] Added login handler in the service worker to bridge the UI to the backend.
- [x] Styled login status messages (success/error states).

## Remaining Work
- [ ] Confirm backend has `/v1/auth/login` and `/v1/auth/refresh` endpoints.
- [ ] Wire credentials (username/password) into the login UI if needed.
- [ ] Test the full flow end-to-end.

