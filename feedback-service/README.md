# Flow Shuttle feedback service

This is the narrow server-side service for the explicit-submit feedback form in Flow Shuttle. It accepts only a message, an optional contact email, and up to five optional screenshots. It never receives editor text, work records, logs, API keys, device identifiers, or other local application data unless a user deliberately includes that information in the form or screenshot.

## Runtime

- Python 3.10+
- Flask behind Gunicorn on loopback
- SQLite metadata and durable email outbox
- Original screenshots in a private directory outside the Nginx web root
- SMTP settings and recipient supplied only through `/etc/flow-shuttle-feedback.env`

The service returns `202 Accepted` only after the feedback row, screenshot metadata, private files, and outbox row are durable. Email delivery is asynchronous. If SMTP is unavailable, the accepted feedback remains in SQLite and the outbox retries after restart.

Feedback records, their email-outbox rows, and private screenshots are retained for 180 days by default. The service checks once per day and retries later if a screenshot cannot be removed safely.

## Local verification

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Public contract

- `POST /api/flow-shuttle/feedback`
- `multipart/form-data`
- `message`: required, trimmed, 1-2,000 Unicode characters
- `email`: optional, no more than 254 characters
- `screenshots`: zero to five repeated PNG/JPEG/WebP parts; each original at most 5 MiB

Unknown fields, repeated message/email fields, mismatched MIME types/extensions, undecodable images, oversized images, and more than five screenshots are rejected. Client errors never echo submitted content or filenames.

Private screenshot URLs use an expiring HMAC-authenticated token. Only a hash of the active token is stored. Nginx does not expose the screenshot directory as static files.

## Server layout

```text
/opt/services/flow-shuttle-feedback/
  current -> releases/<release-id>
  releases/<release-id>/.venv/
/var/lib/flow-shuttle-feedback/
  feedback.sqlite3
  screenshots/
/etc/flow-shuttle-feedback.env
/etc/systemd/system/flow-shuttle-feedback.service
```

The deployment files under `deploy/` are templates for the current Tencent Cloud host. Install the Nginx rate-limit file in `conf.d`, the location file under `snippets`, and include the location file only from the existing HTTPS server block. Always back up the existing site file, run `nginx -t`, and restore the backup if validation fails.

Automatic retention deletion is enabled with a 180-day default. Configure it through `FLOW_FEEDBACK_RETENTION_DAYS`; `FLOW_FEEDBACK_RETENTION_CHECK_SECONDS` controls how often the service checks for expired records.

## Rollback

Each deployment retains its prior release. To roll back application code, create a temporary symlink to the intended earlier release, atomically replace `current`, restart `flow-shuttle-feedback.service`, and verify the loopback health endpoint. Do not change or delete `/var/lib/flow-shuttle-feedback`, because it contains accepted feedback and private screenshots.

If an Nginx rollback is required, restore the timestamped site-file backup under `/opt/services/flow-shuttle-feedback/backups/`, remove only the two Flow Shuttle-specific Nginx files, run `nginx -t`, and reload Nginx only after validation succeeds. Keep `/etc/flow-shuttle-feedback.env` root-only and never copy it into a release or repository.
