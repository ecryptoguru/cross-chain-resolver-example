use near_sdk::{
    test_utils::{get_logs, VMContextBuilder},
    testing_env, AccountId, VMContext,
};

use cross_chain_resolver_example::{
    model::order::{Order, OrderStatus},
    shade_agent::ShadeAgent,
    tee::{TeeAttestation, TeeRegistry, TeeType},
};

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
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    TeeAttestation {
        public_key: public_key.to_string(),
        tee_type: TeeType::Sgx,
        owner_id: owner_id.parse().unwrap(),
        metadata: r#"{"enclave_quote":"test_quote"}"#.to_string(),
        signature: "test_signature".to_string(),
        created_at: current_time,
        expires_at: current_time + expires_in,
        revoked_at: None,
    }
}

// Helper function to create a test order
fn create_test_order() -> Order {
    Order {
        id: "test_order_1".to_string(),
        status: OrderStatus::Pending,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        // Add other required order fields with default values
        ..Default::default()
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

    // Register a test attestation
    let public_key = "test_public_key".to_string();
    let attestation = create_test_attestation(&public_key, &owner_id.to_string(), 3600);
    
    // Verify the attestation is valid
    assert!(attestation.verify().is_ok());
    
    // Register the attestation
    registry.register_attestation(
        public_key.clone(),
        TeeType::Sgx,
        attestation.metadata.clone(),
        attestation.signature.clone(),
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
    testing_env!(context);

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
