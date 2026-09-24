#!/usr/bin/env bash
# Larabee Homes — Twilio shared line preflight
#
# Confirms that an approved A2P campaign is actually wired to the number you
# send from. An approved campaign attached to a Messaging Service that does not
# contain your number still gets filtered, and the symptom looks like a bug in
# your application code.
#
# Reads credentials from the environment. Never hardcode them, and never commit
# them:
#
#   export TWILIO_ACCOUNT_SID=AC...
#   export TWILIO_AUTH_TOKEN=...
#   ./preflight.sh +15551234567
#
# Read-only. Every call below is a GET.

set -euo pipefail

NUMBER="${1:-}"

if [[ -z "${TWILIO_ACCOUNT_SID:-}" || -z "${TWILIO_AUTH_TOKEN:-}" ]]; then
  echo "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first." >&2
  exit 1
fi

AUTH="${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}"
MSG_API="https://messaging.twilio.com/v1"
API="https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}"

# jq makes the output readable but is not required; without it we print raw
# JSON, which is also the safe fallback if Twilio renames a field.
if command -v jq >/dev/null 2>&1; then HAVE_JQ=1; else HAVE_JQ=0
  echo "note: jq not found, printing raw JSON" >&2
fi

get() { curl -sS --fail-with-body -u "$AUTH" "$1"; }

show() {  # show <jq filter> ; falls back to raw passthrough
  if [[ $HAVE_JQ -eq 1 ]]; then jq -r "$1"; else cat; fi
}

echo "=============================================================="
echo " 1. Brand registrations"
echo "=============================================================="
# Sole Proprietor brands can register exactly ONE number. If that is what you
# have, a separate number for tech dispatch is not available to you.
get "${MSG_API}/a2p/BrandRegistrations" | show '
  .data[]? | "  \(.sid)
    status      : \(.status)
    brand type  : \(.brand_type // .entity_type // "?")
    identity    : \(.identity_status // "?")
    failure     : \(.failure_reason // "none")"'

echo
echo "=============================================================="
echo " 2. Messaging Services and their A2P campaigns"
echo "=============================================================="
SERVICES=$(get "${MSG_API}/Services?PageSize=50")

if [[ $HAVE_JQ -eq 1 ]]; then
  SIDS=$(echo "$SERVICES" | jq -r '.services[]?.sid')
else
  echo "$SERVICES"
  SIDS=""
fi

for SID in $SIDS; do
  NAME=$(echo "$SERVICES" | jq -r --arg s "$SID" '.services[] | select(.sid==$s) | .friendly_name')
  echo
  echo "  ── $NAME  ($SID)"

  # The campaign attaches to the Messaging Service, not to the number.
  CAMPAIGN=$(get "${MSG_API}/Services/${SID}/Compliance/Usa2p" 2>/dev/null || echo '{}')
  echo "$CAMPAIGN" | show '
    if (.campaign_status // .status // null) then
      "     campaign  : \(.campaign_status // .status)
     use case  : \(.us_app_to_person_usecase // "?")
     brand     : \(.brand_registration_sid // "?")
     links/tel : \(.has_embedded_links // "?") / \(.has_embedded_phone // "?")
     throughput: \(.rate_limits // "not reported")
     errors    : \(.errors // [] | if length == 0 then "none" else . end)"
    else "     campaign  : none attached to this Messaging Service" end'

  # Sender pool. A number that is not in here is not covered by the campaign.
  POOL=$(get "${MSG_API}/Services/${SID}/PhoneNumbers?PageSize=50")
  echo "$POOL" | show '
    if (.phone_numbers | length) == 0 then "     senders   : (empty sender pool)"
    else "     senders   : " + ([.phone_numbers[].phone_number] | join(", ")) end'

  if [[ -n "$NUMBER" && $HAVE_JQ -eq 1 ]]; then
    if echo "$POOL" | jq -e --arg n "$NUMBER" '.phone_numbers[]? | select(.phone_number==$n)' >/dev/null; then
      echo "     >>> $NUMBER IS in this service's sender pool"
    fi
  fi
done

if [[ -n "$NUMBER" ]]; then
  echo
  echo "=============================================================="
  echo " 3. Webhook configuration for $NUMBER"
  echo "=============================================================="
  # Missive (or your own app) sets these. Two systems cannot own the same
  # incoming webhook: if you need both a shared inbox and your own automation
  # on one number, fan out from a single endpoint rather than pointing the
  # number at two places.
  get "${API}/IncomingPhoneNumbers.json?PhoneNumber=${NUMBER}" | show '
    .incoming_phone_numbers[]? | "  \(.phone_number)  (\(.friendly_name))
    SMS url     : \(.sms_url // "(unset)")  [\(.sms_method // "-")]
    SMS fallback: \(.sms_fallback_url // "(unset)")
    Voice url   : \(.voice_url // "(unset)")  [\(.voice_method // "-")]
    Status cb   : \(.status_callback // "(unset)")
    Bundled MS  : \(.messaging_service_sid // "(none — inbound SMS will use the number webhook above)")"'
fi

echo
echo "Checklist:"
echo "  [ ] campaign status is APPROVED / VERIFIED"
echo "  [ ] your number appears in that same service's sender pool"
echo "  [ ] registered use case covers prospect outreach, not just customer care"
echo "  [ ] brand type noted — Sole Proprietor means one number only"
