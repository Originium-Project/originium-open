#!/usr/bin/env bash
# Forward to the monorepo runner so external documentation links remain visible.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
exec "$root/scripts/check-local.sh" "$@"
