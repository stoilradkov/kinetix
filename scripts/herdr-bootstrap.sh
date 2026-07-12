#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

if [[ -z ${HERDR_WORKSPACE_ID:-} || -z ${HERDR_TAB_ID:-} ]]; then
  echo 'Run this script inside the first blank Kinetix Herdr pane.' >&2
  echo 'Start Herdr with: cd ~/kinetix && herdr' >&2
  exit 1
fi

for command in herdr jq nvim pnpm docker codex lazygit; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

existing_tabs=$(herdr tab list --workspace "$HERDR_WORKSPACE_ID")
if jq -e '.result.tabs[].label | select(. == "Code" or . == "Infra" or . == "Dev" or . == "Codex" or . == "Git")' \
  >/dev/null <<<"$existing_tabs"; then
  echo 'This workspace already contains a Kinetix tab. Refusing to create duplicates.' >&2
  exit 1
fi

create_tab() {
  local label=$1

  herdr tab create \
    --workspace "$HERDR_WORKSPACE_ID" \
    --cwd "$ROOT_DIR" \
    --label "$label" \
    --no-focus
}

herdr tab rename "$HERDR_TAB_ID" Code >/dev/null

infra=$(create_tab Infra)
infra_pane=$(jq -er '.result.root_pane.pane_id' <<<"$infra")
herdr pane run "$infra_pane" 'docker compose up postgres' >/dev/null

dev=$(create_tab Dev)
dev_pane=$(jq -er '.result.root_pane.pane_id' <<<"$dev")
herdr pane split "$dev_pane" \
  --direction down \
  --ratio 0.72 \
  --cwd "$ROOT_DIR" \
  --no-focus >/dev/null
herdr pane run "$dev_pane" 'pnpm dev' >/dev/null

codex_tab=$(create_tab Codex)
codex_pane=$(jq -er '.result.root_pane.pane_id' <<<"$codex_tab")
herdr pane run "$codex_pane" codex >/dev/null

git_tab=$(create_tab Git)
git_pane=$(jq -er '.result.root_pane.pane_id' <<<"$git_tab")
herdr pane run "$git_pane" lazygit >/dev/null

herdr tab focus "$HERDR_TAB_ID" >/dev/null

echo 'Kinetix workspace created. Opening Neovim…'
cd "$ROOT_DIR"
exec nvim .
