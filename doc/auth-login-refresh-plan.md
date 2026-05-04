# Auth Login and Token Refresh Plan

## Context
The learning service now validates authentication tokens directly. The ODH extension previously relied on a JWT for API calls, but token ownership and lifecycle must now be handled as part of the integrated auth flow.

## Goals
- Let the user log in from the extension or the connected auth flow.
- Attach a valid access token to learning service API requests.
- Detect expired or invalid tokens and refresh them automatically when possible.
- Recover cleanly when refresh fails by prompting the user to log in again.

## Scope
- Extension-side auth state and request handling.
- Token storage and retrieval.
- Refresh flow when the access token expires.
- Handling unauthorized responses from the learning service.

## Proposed Flow
1. User signs in through the auth flow.
2. Extension receives an access token and refresh token.
3. Tokens are stored securely in the extension state.
4. API requests send the access token in the `Authorization` header.
5. If the learning service returns `401` or a token-expired response:
   - attempt refresh using the refresh token,
   - update stored tokens,
   - retry the failed request once.
6. If refresh fails:
   - clear stale tokens,
   - mark the user as logged out,
   - request login again.

## Implementation Tasks
- Add an auth session manager for login state, access token, refresh token, and expiry metadata.
- Update `serverconnect.js` to read the current token before each request.
- Add a refresh request path that runs only once per failed request to avoid loops.
- Centralize `401` handling so all API calls follow the same retry rules.
- Add persistence for token data using the existing storage mechanism in the extension.
- Add user-facing messages for login required, refresh success, and refresh failure.

## API Contract Assumptions
- Access token is passed as `Bearer <token>`.
- Refresh token endpoint exists or will be exposed by the auth backend.
- Learning service returns `401` when the token is expired or invalid.
- Response payload can distinguish expired-token cases if needed, but `401` is the fallback signal.

## Edge Cases
- Refresh token is missing or already expired.
- Multiple API requests fail at the same time and try to refresh together.
- Network failure during refresh.
- User revokes access or signs out from another device.

## Acceptance Criteria
- A signed-in user can call learning service APIs without manually supplying a token.
- Expired access tokens are refreshed automatically when possible.
- Failed refresh redirects the user to login instead of retrying forever.
- Existing save-word flows continue working with the new auth layer.

## Next Step
Implement the auth session manager, then wire `ServerConnect` to it so requests can refresh transparently.
