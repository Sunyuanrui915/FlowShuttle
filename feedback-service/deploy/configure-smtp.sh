#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/etc/flow-shuttle-feedback.env
ENV_BACKUP=/etc/flow-shuttle-feedback.env.pre-smtp
SERVICE_NAME=flow-shuttle-feedback.service

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Feedback service environment file is missing." >&2
  exit 1
fi

read -r -p "Recipient email: " recipient
read -r -p "QQ SMTP account: " username
read -r -s -p "QQ SMTP authorization code: " password
echo

email_pattern='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
if [[ ! "$recipient" =~ $email_pattern ]] || [[ ! "$username" =~ $email_pattern ]]; then
  echo "Email address format is invalid." >&2
  exit 1
fi
if [[ ! "$password" =~ ^[A-Za-z0-9]+$ ]] || [[ ${#password} -lt 8 ]]; then
  echo "Authorization code format is invalid." >&2
  exit 1
fi

temporary_file=$(mktemp)
trap 'rm -f "$temporary_file"' EXIT
sudo grep -Ev '^FLOW_FEEDBACK_(SMTP_ENABLED|SMTP_HOST|SMTP_PORT|SMTP_SECURITY|SMTP_USERNAME|SMTP_PASSWORD|SMTP_FROM|RECIPIENT)=' "$ENV_FILE" > "$temporary_file"
{
  printf 'FLOW_FEEDBACK_SMTP_ENABLED=true\n'
  printf 'FLOW_FEEDBACK_SMTP_HOST=smtp.qq.com\n'
  printf 'FLOW_FEEDBACK_SMTP_PORT=465\n'
  printf 'FLOW_FEEDBACK_SMTP_SECURITY=ssl\n'
  printf 'FLOW_FEEDBACK_SMTP_USERNAME=%s\n' "$username"
  printf 'FLOW_FEEDBACK_SMTP_PASSWORD=%s\n' "$password"
  printf 'FLOW_FEEDBACK_SMTP_FROM=%s\n' "$username"
  printf 'FLOW_FEEDBACK_RECIPIENT=%s\n' "$recipient"
} >> "$temporary_file"

if [[ ! -e "$ENV_BACKUP" ]]; then
  sudo cp -a -- "$ENV_FILE" "$ENV_BACKUP"
fi
sudo install -o root -g root -m 600 "$temporary_file" "$ENV_FILE"
password=''
if ! sudo systemctl restart "$SERVICE_NAME"; then
  sudo cp -a -- "$ENV_BACKUP" "$ENV_FILE"
  sudo systemctl restart "$SERVICE_NAME"
  echo "Service restart failed; the previous environment was restored." >&2
  exit 1
fi
sudo systemctl --no-pager --full is-active "$SERVICE_NAME"
for health_attempt in {1..20}; do
  if health_payload=$(curl --fail --silent http://127.0.0.1:17832/health); then
    printf '%s\n' "$health_payload"
    exit 0
  fi
  sleep 1
done
echo "Service did not become healthy within 20 seconds." >&2
exit 1
