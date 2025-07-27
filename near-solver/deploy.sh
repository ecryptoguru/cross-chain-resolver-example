#!/bin/bash
set -e

# Configuration
CONTRACT_NAME="near-solver"
MAIN_ACCOUNT="${1:-your-account.testnet}"  # First argument or default to your-account.testnet
NETWORK="testnet"
INITIAL_BALANCE="10"  # Initial balance in NEAR

# Ensure the user is logged in
if ! near whoami &> /dev/null; then
    echo "Please log in to your NEAR account using 'near login'"
    exit 1
fi

# Create a sub-account for the solver if it doesn't exist
SOLVER_ACCOUNT="${CONTRACT_NAME}.${MAIN_ACCOUNT}"
if ! near view-state $SOLVER_ACCOUNT --finality final &> /dev/null; then
    echo "Creating sub-account: $SOLVER_ACCOUNT"
    near create-account $SOLVER_ACCOUNT --masterAccount $MAIN_ACCOUNT --initialBalance $INITIAL_BALANCE
else
    echo "Sub-account $SOLVER_ACCOUNT already exists"
fi

# Build the contract
echo "Building the contract..."
cargo build --target wasm32-unknown-unknown --release

# Deploy the contract
echo "Deploying the contract to $SOLVER_ACCOUNT..."
near deploy --wasmFile target/wasm32-unknown-unknown/release/near_solver.wasm \
    --accountId $SOLVER_ACCOUNT \
    --initFunction new \
    --initArgs '{"owner_id":"'$MAIN_ACCOUNT'"}' \
    --networkId $NETWORK

echo "Deployment complete!"
echo "Contract address: $SOLVER_ACCOUNT"
echo "You can now interact with the contract using NEAR CLI:"
echo "  near call $SOLVER_ACCOUNT <method_name> '{}' --accountId $MAIN_ACCOUNT"
