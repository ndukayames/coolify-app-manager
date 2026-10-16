# Codeva Console

A private, dark-mode console for monitoring a Coolify instance, triggering deployments, and managing application environment variables.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with an account created by `npm run user:add`. Codeva Console does not include fallback or demo data; Coolify must be configured before application data can load.

## Connect Coolify

Create `.env.local` with your Coolify instance origin, API token, and a private dashboard access key:

```dotenv
COOLIFY_BASE_URL=https://coolify.example.com
COOLIFY_API_TOKEN=your-api-token
DASHBOARD_ACCESS_KEY=your-private-access-key
```

Generate a strong access key with:

```bash
openssl rand -base64 32
```

Create the token in Coolify under **Keys & Tokens → API tokens**. The current feature set needs these permissions:

- `read` for applications and deployments
- `read:sensitive` for environment variables and deployment logs
- `write` for environment variable updates
- `deploy` to trigger deployments

Restart the development server after changing `.env.local`.

## Checks

```bash
npm run lint
npm run build
```

## Access control

The Coolify token and dashboard key remain on the server and are never sent to the browser. A valid dashboard key creates an HttpOnly, same-site session cookie for seven days. Changing `DASHBOARD_ACCESS_KEY` invalidates all existing sessions.

Every Coolify API route verifies the session independently. For a public deployment, use HTTPS and consider adding rate limiting at the reverse proxy or hosting layer.
