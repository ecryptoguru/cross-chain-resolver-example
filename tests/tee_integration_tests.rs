use near_sdk::{
    test_utils::{get_logs, VMContextBuilder},
    testing_env, AccountId, VMContext, env,
};
use base64::Engine as _;

// Import the contract crate
use near_solver::{
    model::order::{CrossChainOrder, OrderStatus},
    shade_agent::ShadeAgent,
    tee::{TeeAttestation, TeeRegistry, types::TeeType as TeeTypeTrait},
};

// This is required for the test build to work
mod near_solver {}

// Helper function to get the VM context for testing
fn get_context(is_view: bool) -> VMContext {
    VMContextBuilder::new()
        .current_account_id("test.testnet".parse().unwrap())
        .signer_account_id("bob.testnet".parse().unwrap())
        .predecessor_account_id("bob.testnet".parse().unwrap())
        .is_view(is_view)
        .build()
}

// Helper function to create a test TEE attestation
fn create_test_attestation(public_key: &str, owner_id: &str, expires_in: u64) -> TeeAttestation {
    let now = env::block_timestamp() / 1_000_000; // Convert to seconds
    let report = "test_report".to_string();
    let signature = "test_signature".to_string();
    let attestation_id = format!("{}-{}-{}", public_key, now, expires_in);
    
    TeeAttestation {
        tee_type: "sgx".to_string(),
        public_key: public_key.to_string(),
        report: base64::engine::general_purpose::STANDARD.encode(&report),
        signature: base64::engine::general_purpose::STANDARD.encode(&signature),
        timestamp: now,
        expires_at: now + expires_in,
        signer_id: owner_id.parse().unwrap(),
        attestation_id,
        version: "1.0.0".to_string(),
        metadata: None,
    }
}

// Helper function to create a test order
fn create_test_order() -> CrossChainOrder {
    let now = env::block_timestamp() / 1_000_000; // Convert to seconds
    
    CrossChainOrder {
        id: "test_order_1".to_string(),
        source_chain: "ethereum".to_string(),
        dest_chain: "near".to_string(),
        source_token: "0xA0b86a33E6441c8C06DD2b7c94b7E5c88b5c5c5c".to_string(),
        dest_token: "wrap.near".to_string(),
        amount: 1000000000000000000, // 1 token with 18 decimals
        source_amount: 1000000000000000000,
        dest_amount: 1000000000000000000,
        source_address: "0xB1c96a33E6441c8C06DD2b7c94b7E5c88b5c5c5c".to_string(),
        dest_address: "user.near".to_string(),
        min_amount_out: 1000000000000000000,
        creator: env::predecessor_account_id(),
        recipient: "user.near".parse().unwrap(),
        status: OrderStatus::Created,
        created_at: now,
        expires_at: now + 3600, // 1 hour from now
        timelock: now + 3600,
        hashlock: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
        tee_attestation_id: None,
        metadata: None,
        updated_at: now,
    }
}

#[test]
fn test_tee_attestation_verification() {
    // Setup test environment
    let context = get_context(false);
    testing_env!(context);

    // Initialize the TEE registry
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());

    // Create a test attestation
    let public_key = "test_public_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 3600);
    
    // Verify the attestation is valid
    assert!(attestation.validate().is_ok());
    
    // Register the attestation
    registry.register_attestation(
        attestation.public_key.clone(),
        TeeType::Sgx,
        serde_json::to_string(&attestation.metadata).unwrap_or_else(|_| "{}".to_string()),
        attestation.signature,
        attestation.expires_at,
    ).unwrap();

    // Verify the attestation is registered and valid
    assert!(registry.is_attestation_valid(public_key.clone()));
    
    // Test revoking the attestation
    registry.revoke_attestation(public_key.clone()).unwrap();
    
    // Verify the attestation is no longer valid
    assert!(!registry.is_attestation_valid(public_key));
}

#[test]
fn test_shade_agent_with_tee_verification() {
    // Setup test environment
    let context = get_context(false);
    testing_env!(context.clone());
    
    // Initialize the TEE registry
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());
    
    // Create and register a test attestation
    let public_key = "test_public_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 3600);
    
    // Register the attestation
    registry.register_attestation(
        attestation.public_key.clone(),
        TeeType::Sgx,
        serde_json::to_string(&attestation.metadata).unwrap_or_else(|_| "{}".to_string()),
        attestation.signature,
        attestation.expires_at,
    ).unwrap();
    
    // Create a test order
    let order = create_test_order();
    
    // Create a ShadeAgent with the registry
    let mut agent = ShadeAgent::new(registry);
    
    // Test processing the order with TEE verification
    agent.process_order(order).unwrap();

    // Initialize the TEE registry
    let registry_account: AccountId = "registry.testnet".parse().unwrap();
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());

    // Register a test attestation
    let public_key = "test_public_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 3600);
    
    registry.register_attestation(
        public_key.clone(),
        TeeType::Sgx,
        attestation.metadata.clone(),
        attestation.signature.clone(),
        attestation.expires_at,
    ).unwrap();

    // Initialize the Shade Agent with the TEE registry
    let admin_id: AccountId = "admin.testnet".parse().unwrap();
    let mut agent = ShadeAgent::new(registry_account.clone(), admin_id.clone());

    // Create a test order
    let order = create_test_order();

    // Process the order with TEE verification
    let result = agent.process_order(order, public_key.clone(), attestation);
    
    // Verify the order was processed successfully
    assert!(result.is_ok());
    
    // Check that the order processing events were emitted
    let logs = get_logs();
    assert!(logs.iter().any(|log| log.contains("ORDER_PROCESSING_STARTED")));
    assert!(logs.iter().any(|log| log.contains("ORDER_PROCESSING_COMPLETED")));
}

#[test]
fn test_invalid_tee_attestation() {
    // Setup test environment
    let context = get_context(false);
    testing_env!(context);
    
    // Initialize the TEE registry
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());
    
    // Create an invalid attestation (empty public key)
    let public_key = "".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 3600);
    
    // Verify the attestation is invalid
    assert!(attestation.validate().is_err());
    
    // Attempt to register the invalid attestation should fail
    let result = registry.register_attestation(
        attestation.public_key,
        TeeType::Sgx,
        serde_json::to_string(&attestation.metadata).unwrap_or_else(|_| "{}".to_string()),
        attestation.signature,
        attestation.expires_at,
    );
    
    assert!(result.is_err());

    // Initialize the TEE registry
    let registry_account: AccountId = "registry.testnet".parse().unwrap();
    let admin_id: AccountId = "admin.testnet".parse().unwrap();
    let agent = ShadeAgent::new(registry_account, admin_id);

    // Create a test order
    let order = create_test_order();
    
    // Create an attestation with an invalid signature
    let public_key = "invalid_public_key".to_string();
    let mut attestation = create_test_attestation(&public_key, "owner.testnet", 3600);
    attestation.signature = "invalid_signature".to_string();

    // Process the order with invalid TEE attestation
    let result = agent.process_order(order, public_key, attestation);
    
    // Verify the order processing failed due to invalid attestation
    assert!(result.is_err());
    
    // Check that the error event was emitted
    let logs = get_logs();
    assert!(logs.iter().any(|log| log.contains("TEE_VERIFICATION_FAILED")));
}

#[test]
fn test_expired_tee_attestation() {
    // Setup test environment
    let context = get_context(false);
    testing_env!(context);
    
    // Initialize the TEE registry
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());
    
    // Create an attestation that's already expired (expires_in = 0)
    let public_key = "expired_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 0);
    
    // Verify the attestation is invalid due to expiration
    assert!(attestation.validate().is_err());
    
    // Attempt to register the expired attestation should fail
    let result = registry.register_attestation(
        attestation.public_key,
        TeeType::Sgx,
        serde_json::to_string(&attestation.metadata).unwrap_or_else(|_| "{}".to_string()),
        attestation.signature,
        attestation.expires_at,
    );
    
    assert!(result.is_err());

    // Initialize the TEE registry
    let registry_account: AccountId = "registry.testnet".parse().unwrap();
    let owner_id: AccountId = "owner.testnet".parse().unwrap();
    let mut registry = TeeRegistry::new(owner_id.clone());

    // Register an expired attestation
    let public_key = "expired_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 0);
    
    registry.register_attestation(
        public_key.clone(),
        TeeType::Sgx,
        attestation.metadata.clone(),
        attestation.signature.clone(),
        attestation.expires_at,
    ).unwrap();

    // Initialize the Shade Agent
    let admin_id: AccountId = "admin.testnet".parse().unwrap();
    let agent = ShadeAgent::new(registry_account, admin_id);

    // Create a test order
    let order = create_test_order();

    // Process the order with expired TEE attestation
    let result = agent.process_order(order, public_key, attestation);
    
    // Verify the order processing failed due to expired attestation
    assert!(result.is_err());
    
    // Check that the error event was emitted
    let logs = get_logs();
    assert!(logs.iter().any(|log| log.contains("TEE_VERIFICATION_FAILED")));
}
