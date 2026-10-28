# openGym Muse connector

A standalone **read-only MCP connector** that lets Meta Muse access workout
summaries and training plans from **any user's own self-hosted openGym instance**.

The connector accepts an openGym instance URL in its MCP URL and **each user's
own openGym paired-device token in the Authorization header supplied by Muse's
secure credential store**. It does not require or store shared user credentials,
a default openGym instance URL, or an AI API key.

**Status:** public, open-source prototype; not yet published, approved or tested
end-to-end in a live Muse account. This is **not** an official openGym or Meta
project. Publishing the source does not make it a directory-listed Muse connector.

## Tools

| MCP tool | Data exposed |
| --- | --- |
| `workout_summary` | Workout dates/count, completed sets and routine names in a time window |
| `recent_workouts` | Completed sets with reps, weight, duration and exercise IDs |
| `training_plan` | Saved routine names, exercise IDs, targets and weekly assignments |

The connector does **not** return notes, bodyweight, progress photos, profile
details, credentials, or the full saved openGym state. Calls only use
authenticated `GET /api/data`, which may update upstream last-access metadata.
No tool permits writes.

## Set up your own openGym account in Muse

**1. Public HTTPS access to openGym.** Your openGym instance must have a DNS
hostname and valid HTTPS certificate, reachable from the bridge. For example:

- Standalone: `https://gym.yourdomain.com`
- Home Assistant nginx SSL proxy: `https://ha.yourdomain.com/opengym`

The bridge rejects non-HTTPS URLs, local/private IPs, IP literals and
nonstandard ports to protect publicly hosted bridge installations.
A localhost or VPN-only openGym instance will not work with a publicly
hosted bridge.

**2. Create a dedicated openGym account pairing token.** Sign in to the
appropriate openGym profile in the browser, then choose **Settings → Account →
Pair the mobile app**. Copy the one-time code (about five minutes lifetime).
On a trusted computer running Node.js 20 or later, redeem it using:

```sh
node scripts/redeem-pairing-code.mjs https://ha.yourdomain.com/opengym
```

The helper prompts for the code and prints the resulting bearer token locally.
**Treat that token like a password.** Do not paste it into a Muse conversation,
a public issue, or any URL. The helper sends the code directly to openGym
without contacting the connector service.

**3. Run or choose a trusted MCP bridge.** Node.js 20+ and no third-party runtime
dependencies:

```sh
npm test
npm start
# HTTP MCP listener defaults to 127.0.0.1:8765
```

To run in a container with only a local host port published:

```sh
docker build -t opengym-muse-connector .
docker run --rm -p 127.0.0.1:8765:8765 opengym-muse-connector
```

Put a trusted HTTPS reverse proxy in front of the localhost MCP listener;
Muse cannot reach your machine's localhost. Never expose unencrypted port
8765 to the public internet.

**4. Configure Muse.** If the bridge lives at `https://connector.example.com`,
and the personal openGym URL is `https://ha.yourdomain.com/opengym`, use:

```text
https://connector.example.com/mcp?instance=https%3A%2F%2Fha.yourdomain.com%2Fopengym
```

Give Muse the endpoint and request a **custom MCP Streamable HTTP connector
using Bearer authentication**. When it offers a **secure credentials prompt**,
enter your openGym paired-account bearer token there. Do not provide that
token in chat. Muse should send it as the HTTP Authorization: Bearer header
for each connector request.

A [copyable Muse setup prompt](examples/muse-setup-prompt.md) is provided.
The user's openGym URL is configuration, not a secret. **The token is the
only credential needed for the bridge.**

**5. Verify.** Test tools/list first, then request workout_summary. You
can also test a running MCP bridge with a local environment variable:

```sh
export OPENGYM_TOKEN='TOKEN_ENTERED_ONLY_IN_YOUR_LOCAL_SHELL'
curl -fsS 'https://connector.example.com/mcp?instance=https%3A%2F%2Fha.yourdomain.com%2Fopengym' \
  -H "Authorization: Bearer $OPENGYM_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Privacy and security

- There are **no hardcoded account secrets**, shared credentials, user state
  database or cross-user workout caches.
- Each MCP call uses only the Bearer token in **that caller's request**.
  A bridge operator still sees bearer tokens in transient process memory:
  use a bridge run by someone you trust, or self-host.
- The bridge makes GET requests only. Upstream openGym paired-device tokens
  are **not scoped read-only**, so a stolen original token may authorize
  writes to openGym even though the connector never does.
- Outbound requests require public IPv4 DNS, a pinned vetted IP socket,
  valid HTTPS certificate, no redirects and bounded responses. IPv6-only
  instances are currently unsupported.
- Inbound requests have origin validation, bounded bodies and rate limits.
  The service binds to localhost by default and has no built-in TLS.
- Muse receives the selected tool results; your data may also be handled
  according to Meta's own terms. No secondary use of training data is made
  by this connector.
- Tokens eventually expire, and sign-out-everywhere revokes them. Pair again
  and replace the secret in Muse when needed. This prototype does not refresh
  paired tokens automatically.
- The bridge answers stateless Streamable HTTP MCP POST requests with JSON.
  It doesn't implement SSE or OAuth. Muse's live custom-connector onboarding
  behavior still needs testing.

A public directory connector generally requires additional OAuth account
linking, consent flow, privacy/security policies, operator contact details,
review and deployment hardening. See [Muse connector guidelines](https://platform.muse.ai/docs).
**Publicly reusable source is not proof of production-readiness or directory approval.**

## Development

```sh
node --check src/server.mjs
node --check src/lib.mjs
npm test
```

CI checks token isolation, URL filtering, MCP behavior and privacy-sensitive
output. This repository is independent of the Home Assistant wrapper and
does not need Home Assistant nginx or wrapper code changes.
