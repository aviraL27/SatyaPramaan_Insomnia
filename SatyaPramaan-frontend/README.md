# DigiSecure Frontend

React + Vite frontend integrated with DigiSecure backend APIs and Firebase Authentication.

## Environment Setup

Copy `.env.example` to `.env` and fill values.

Required values:

- `VITE_API_BASE_URL` (example: `http://localhost:4000/api/v1`)
- `VITE_API_ORIGIN` (example: `http://localhost:4000`)
- Firebase web app keys:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`

## Run

```powershell
npm.cmd install
npm.cmd run dev
```

## Build

```powershell
npm.cmd run build
```

## Implemented Backend Integrations

- Auth: Firebase sign-in/register + `/api/v1/auth/bootstrap` + `/api/v1/auth/me`
- Issuance: `/api/v1/documents/issue`
- Documents: list/detail/revoke/replace/download/versions
- Verification: QR verify + upload verify + result rendering
- Audit: list + verify-chain
- Trust: score + history
- Institution profile update
