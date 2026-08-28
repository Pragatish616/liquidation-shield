#!/usr/bin/env bash
set -euo pipefail
source .env
anvil \
  --fork-url "$MAINNET_RPC" \
  --fork-block-number "$FORK_BLOCK" \
  --chain-id 31337 \
  --port "${ANVIL_PORT:-8545}" \
  --accounts 10 \
  --balance 10000
