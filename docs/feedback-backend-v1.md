# Flow Shuttle feedback backend v1 contract

## Scope

The desktop app stays local-first. A feedback request is sent only after the user presses the submit button. The client must never attach editor content, work records, logs, API keys, file paths, device identifiers, or other local context automatically.

Version 1 provides a narrow HTTPS endpoint and email notification. It does not include a feedback administration dashboard.

## Recommended deployment topology

```text
Flow Shuttle desktop app
  -> HTTPS POST /api/flow-shuttle/feedback
  -> Nginx (request-size limit and coarse rate limit)
  -> loopback-only feedback service managed by systemd
  -> SQLite feedback record + durable email outbox
  -> private screenshot directory outside every Nginx web root
  -> SMTP service configured only through server environment
```

The v1 service is deployed on the existing Ubuntu 22.04 host at `https://www.sunyuanrui.com/api/flow-shuttle/feedback`. Nginx terminates TLS and proxies only this route and its signed screenshot route to the loopback-only service on `127.0.0.1:17832`.

The Electron build receives only the public HTTPS endpoint through `FLOW_SHUTTLE_FEEDBACK_ENDPOINT`. It is not a secret. SMTP credentials, recipient addresses, signing keys, and storage paths must never be included in the desktop client.

## Request contract

- Method: `POST`
- Content type: `multipart/form-data`
- Accepted fields only:
  - `message`: required UTF-8 text, 1-2,000 Unicode characters after trimming
  - `email`: optional, at most 254 characters, validated as an email address
  - `screenshots`: optional repeated file field, zero to five original PNG, JPEG, or WebP files; each file is at most 5 MiB
- Unknown fields are rejected. `message` and `email` must not repeat; `screenshots` may repeat at most five times.
- A successful response is `202 Accepted` with a non-sensitive random request ID.
- Error responses contain only a stable error code; they must not echo submitted text, email, file names, server paths, or stack traces.

The server repeats every validation independently of the desktop client. It checks the decoded image signature as well as the reported MIME type and extension.

## Storage

### Feedback text

Use a dedicated SQLite database outside the website directory, for example under `/var/lib/flow-shuttle-feedback/`. Store only the submitted message, optional email, screenshot metadata/paths, creation time, request status, and email-outbox status. Keep screenshot metadata in a child table with a maximum of five rows per feedback request. Do not persist source IP, user agent, work content, application logs, or a device fingerprint.

Insert the feedback row and its email-outbox row in one transaction. Return `202` only after that transaction is durable. The service can attempt email immediately and retry pending outbox records after restarts without asking the user to submit again.

### Screenshots

- Store screenshots outside all Nginx document roots.
- Generate the server-side file name from a cryptographically random UUID; never trust or reuse the client file name.
- Restrict the directory and files to the service account.
- Do not expose the directory through a static Nginx location.
- If an email needs a preview link, serve it through the feedback service using a short-lived, single-purpose signed token. Store only the token hash and expiry. Never put a permanent public URL in email.
- Apply the same backup and retention policy to the SQLite row and its screenshots so they are removed together.
- Retain accepted feedback, its email-outbox row, and private screenshots for 180 days. The service checks daily; a screenshot deletion failure keeps the corresponding database record for a later retry.

## Email notification

The recipient address and all SMTP settings are server environment values. Email content must HTML-escape the message and email address before rendering. The notification may include the request ID, submitted text, optional contact email, and up to five expiring private screenshot links. It must not include server credentials, internal paths, raw request headers, or application logs.

## Required server protections

- HTTPS only; reject redirects and plaintext upstream configuration.
- Nginx and application rate limits, with stricter limits for repeated failures.
- Nginx request body limit slightly above 25 MiB to cover five 5 MiB images plus multipart overhead; the application still enforces five files maximum and 5 MiB per file.
- Server-side field allowlist, character limits, email validation, screenshot-count limit, MIME/signature detection, and image decode check.
- Random server-side screenshot names and private access control.
- Parameterized SQLite statements and transactional writes.
- HTML escaping for notification templates.
- Generic client errors and structured server logs without submitted content or email addresses.
- A dedicated unprivileged systemd service account with write access only to its data directory.

## Deployment status

The user separately approved implementation and deployment on 2026-08-12. The active server layout is:

- Python 3.10 virtual environment and Gunicorn under `/opt/services/flow-shuttle-feedback/current`
- dedicated non-login `flowshuttle-feedback` service account managed by systemd
- SQLite database and private screenshots under `/var/lib/flow-shuttle-feedback`
- root-only SMTP and recipient configuration in `/etc/flow-shuttle-feedback.env`
- Nginx rate-limit configuration in `/etc/nginx/conf.d/flow-shuttle-feedback-rate-limit.conf`
- Nginx proxy locations in `/etc/nginx/snippets/flow-shuttle-feedback-locations.conf`

The active backend release is `/opt/services/flow-shuttle-feedback/releases/20260813-000650`, with the prior release retained for immediate rollback. The personal website repository was not modified. Its existing Nginx site file received only one include line, with the original retained in the feedback service backup directory. The v0.4.0 desktop release build contains only the public HTTPS endpoint; it contains no recipient, SMTP authorization code, signing key, or server path.

Automatic retention deletion is enabled with a 180-day default and a daily cleanup check. The active server environment keeps these values explicit so the policy remains visible to operators.
