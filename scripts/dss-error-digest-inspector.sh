#!/usr/bin/env bash
set -euo pipefail

# DSS Error Digest Inspector
# Checks for real incidents in DSS error buffer and enqueues notifications if needed
# Usage: dss-error-digest-inspector.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Paths
ERROR_BUFFER_DIR="${HOME}/.openclaw/runtime/dss-alerts"
ERROR_BUFFER_FILE="${ERROR_BUFFER_DIR}/error-buffer.ndjson"
SYSTEM_NOTIFY_SCRIPT="${HOME}/.openclaw/scripts/system_notify_enqueue.py"

# Configuration
MAX_AGE_HOURS=24  # Consider errors within last 24 hours
MIN_INCIDENTS_THRESHOLD=1  # Minimum number of incidents to trigger notification

log() {
    printf '[dss-error-inspector] %s\n' "$*" >&2
}

# Check if error buffer exists and has content
if [[ ! -f "$ERROR_BUFFER_FILE" ]] || [[ ! -s "$ERROR_BUFFER_FILE" ]]; then
    log "No error buffer found or empty"
    exit 0
fi

# Filter recent errors (within last MAX_AGE_HOURS)
current_timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cutoff_timestamp=$(date -u -v-${MAX_AGE_HOURS}H +"%Y-%m-%dT%H:%M:%SZ")

recent_errors=$(jq -c --arg cutoff "$cutoff_timestamp" '[select(.ts >= $cutoff) | select(.severity == "error") | select(.category == "ci")]' "$ERROR_BUFFER_FILE" | jq -c '.[] // empty')

# Count recent incidents
incident_count=$(echo "$recent_errors" | wc -l | tr -d ' ')

if [[ "$incident_count" -eq 0 ]] || [[ "$incident_count" -lt "$MIN_INCIDENTS_THRESHOLD" ]]; then
    log "No significant incidents found (threshold: $MIN_INCIDENTS_THRESHOLD, found: $incident_count)"
    exit 0
fi

# Generate incident summary
incident_summary=$(echo "$recent_errors" | jq -r '
  "• " + (.msg // "Unknown error") + " (" + (.context.workflowName // "Unknown workflow") + ")"' | paste -sd " " -)

# Check if we have incidents but they might be normal CI fluctuations
# Heuristic: if we have exactly 1-2 minor incidents, they might be normal
if [[ "$incident_count" -le 2 ]] && echo "$recent_errors" | grep -q "preview\|test"; then
    log "Minor incidents detected, possibly normal CI fluctuations: $incident_count incidents"
    exit 0
fi
# Skip the minor incidents heuristic for testing

# If we reach here, we have significant incidents
log "Significant incidents detected: $incident_count incidents"

# Build notification message
message="🚨 *DSS CI Incidents Detected* ($incident_count incidents in last ${MAX_AGE_HOURS}h)

$incident_summary"

# Check if recent errors are from critical workflows
critical_errors=$(echo "$recent_errors" | jq -c '
  select(.context.workflowName // "" | contains("main") or contains("production") or contains("deploy") or contains("release") or (contains("preview") | not))
')

if [[ -n "$critical_errors" ]]; then
    critical_count=$(echo "$critical_errors" | wc -l | tr -d ' ')
    message="${message}

⚠️ **${critical_count} critical workflow failures detected**"
fi

# Enqueue notification
log "Enqueuing system notification for ${incident_count} incidents"
python3 "$SYSTEM_NOTIFY_SCRIPT" \
    --from-agent "dss-error-digest" \
    --message "$message" \
    --reason "CI failures detected in DSS error digest" \
    --topic-key "dss-incidents" \
    --severity "error" \
    --source-artifact "dss-error-buffer-ndjson"

log "Successfully enqueued notification for $incident_count incidents"
exit 0