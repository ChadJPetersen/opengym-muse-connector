# openGym → Muse Connector (prototype)

Read-only single-user **MCP over HTTP** proof of concept, based on the
openGym v1.4.3 authenticated `GET /api/data` endpoint. It exposes three
tools: `workout_summary`, `recent_workouts` and `training_plan`.
This standalone repository is **not part of the Home Assistant wrapper**. The connector does **not** change workouts, invoke AI Coach, export
bodyweight, or expose free-text notes.

**Not yet published, reviewed, or certified for Muse.** Meta's [Muse
Connector Platform](https://platform.muse.ai/) requires security review,
business documentation, verified credentials, and end-to-end testing.
This project is a starting point, not an installed integration. Meta may
require additional MCP transport/OAuth behavior before accepting it.

## Architecture and repository separation

The existing NGINX Home Assistant SSL proxy rule at `/opengym/api/`
exposes openGym's native, per-profile authentication. This bridge should
remain a **separate service** with its own credentials and TLS/reverse-proxy
controls, not an unauthenticated new route in Home Assistant nginx.

## Configure and launch (Node 20+)

Generate a strong, unique random connector bearer token, and use a
**dedicated openGym profile's paired-device token** (not an admin
password). openGym's pairing tokens are obtained through the normal
`Settings → Account → Pair the mobile app` flow and redeemed at
`POST /api/pair/redeem`. Never commit or paste a token into a GitHub
issue. Pairing tokens remain powerful: openGym does not currently expose
read-only scopes for them.

```sh
export LISTEN_HOST=127.0.0.1
export PORT=8765
export CONNECTOR_BEARER_TOKEN='REPLACE_WITH_UNIQUE_RANDOM_32_PLUS_CHAR_VALUE'
export OPENGYM_URL='https://YOUR_HA_HOST/opengym'
export OPENGYM_BEARER_TOKEN='REPLACE_WITH_PAIRED_ACCOUNT_BEARER_TOKEN'
node src/server.mjs
```

The service accepts authenticated JSON-RPC MCP `initialize`,
`tools/list`, and `tools/call` on POST `/mcp`. Test on localhost:

```sh
curl -fsS http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $CONNECTOR_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Exposing to Meta Muse

**Do not forward localhost HTTP to the public Internet as-is.** You need
a trusted HTTPS endpoint, appropriate firewall rules, per-user OAuth
account authorization if supporting multiple people, rate limiting,
auditability, secure credential storage/rotation, consent, and privacy
documentation. Single shared bearer credentials are unsuitable for
multi-user production use. Configure and test the connector privately
first; submit for review through [platform.muse.ai](https://platform.muse.ai/)
after implementing Muse's current connection/auth requirements.

## Data flow

```text
Muse -- approved tool call / HTTPS --> connector /mcp
  -- bearer authenticated GET --> openGym /opengym/api/data
  -- local filtering --> aggregate workouts and planned routines
```

The read-only tools **never return raw openGym state**. They explicitly
select dates, exercise IDs, completed sets and routine prescriptions.
Free-text notes, profile name, logged bodyweight, photos, account secrets,
other profiles, and unrelated app settings are excluded.

The upstream `GET /api/data` call can mark a profile's last-pull time on
the server; tool calls are logically read-only regarding workout data but
not guaranteed to leave server access metadata unchanged.

## Next production steps

- Check Muse's current connector transport requirements, test the tool
  schema in an actual Muse account, and implement OAuth consent as needed.
- Decide on read-only first versus separate approval-gated writing tools.
- Add per-user scoped authentication, secure credential storage and
  revocation. Prefer a dedicated **read-only API token** upstream; paired
  device tokens themselves permit writes and must be protected accordingly.
- Add deployment automation and HTTPS through the existing Home Assistant
  SSL proxy only after hardening; don't modify the current
  `/opengym/api/` nginx rule just to expose MCP.
- Validate workout counting and calendar dates against real records. The
  summary uses UTC dates; adapt it to your workout calendar timezone.

See [Muse guidelines](https://platform.muse.ai/docs) and
[upstream openGym](https://github.com/DuarteSantos8/openGym).

## Development

Install Node.js 20+ (no npm dependencies required). Run `npm test` to check authentication and MCP tool discovery. CI runs the same test on pushes and pull requests.

The connector is a standalone process; it is not installed, started, or exposed by the Home Assistant app. Credentials must be supplied through environment variables, never committed.
