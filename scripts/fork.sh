#!/usr/bin/env bash
set -euo pipefail
# Requires Foundry <= 1.7.x. Foundry 1.8.0 added a network-family
# auto-detect probe (anvil_nodeInfo) that hard-fails against production RPC
# providers (Alchemy, Infura) which don't implement that Anvil-only debug
# method -- error: "failed to determine network family from fork endpoint".
# `foundryup -i 1.7.1` to pin; `anvil --version` should print 1.7.x.
source .env
anvil \
  --fork-url "$MAINNET_RPC" \
  --fork-block-number "$FORK_BLOCK" \
  --chain-id 31337 \
  --port "${ANVIL_PORT:-8545}" \
  --accounts 10 \
  --balance 10000
