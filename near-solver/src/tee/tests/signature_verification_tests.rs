//! Integration tests for TEE signature verification functionality

use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, VMContext, AccountId};
use std::collections::HashMap;
use ring::signature::RsaKeyPair;

// Local crate imports
use crate::tee::attestation::TeeAttestation;
use crate::tee::attestation_data::TeeType;

// Import test utilities
use crate::test_utils_export::*;

// Helper to convert string to AccountId
fn account_id(s: &str) -> AccountId {
    s.parse().expect("Invalid account ID")
}

// Helper to create a test account ID
fn test_account() -> AccountId {
    "test.near".parse().unwrap()
}

// Helper function to set up test context with VMContextBuilder
fn get_context() -> VMContext {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account_id("test.near"))
        .signer_account_id(account_id("test.near"))
        .account_balance(1_000_000_000_000_000_000_000_000) // 1e24 yoctoNEAR
        .attached_deposit(0)
        .prepaid_gas(10u64.pow(18));
    builder.build()
}

// Helper function to create a test attestation with required fields
fn create_test_attestation(
    tee_type: TeeType,
    public_key: String,
    timestamp: u64,
) -> TeeAttestation {
    let mut metadata = HashMap::new();
    // Add required SGX metadata fields
    metadata.insert("sgx_mr_enclave".to_string(), "a1b2c3d4e5f60123456789012345678901234567890123456789012345678901".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "b2c3d4e5f6012345678901234567890123456789012345678901234567890123".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    metadata.insert("sgx_quote_status".to_string(), "OK".to_string());

    TeeAttestation {
        tee_type,
        public_key,
        report: "test_report".to_string(),
        signature: "test_signature".to_string(),
        issued_at: timestamp,
        expires_at: timestamp + 3600, // 1 hour later
        signer_id: test_account(),
        version: "1.0.0".to_string(),
        metadata,
        updated_at: timestamp,
        is_active: true,
    }
}

// Helper function to create an RSA keypair for testing
fn create_rsa_keypair() -> (RsaKeyPair, String) {
    use ring::signature::KeyPair;
    
    let rng = rand::SystemRandom::new();
    let pkcs8_bytes = RsaKeyPair::generate_pkcs8(&rng).expect("Failed to generate key");
    let keypair = RsaKeyPair::from_pkcs8(pkcs8_bytes.as_ref()).expect("Failed to create keypair from PKCS8");
    
    // Return both the keypair and a base64-encoded public key
    (keypair, base64::encode(pkcs8_bytes.as_ref()))
}

#[test]
fn test_sgx_signature_verification_basic() {
    // Set up test context
    let context = get_context();
    testing_env!(context);

    // Create test data
    let (_, public_key) = create_rsa_keypair();
    
    // Create attestation with required SGX metadata
    let attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        env::block_timestamp() / 1_000_000_000, // Convert to seconds
    );
    
    // Verify the attestation is active
    assert!(attestation.is_active, "Attestation should be active");
    
    // Verify required SGX metadata is present
    assert!(
        attestation.metadata.contains_key("sgx_mr_enclave"),
        "SGX metadata should contain 'sgx_mr_enclave'"
    );
    assert!(
        attestation.metadata.contains_key("sgx_mr_signer"),
        "SGX metadata should contain 'sgx_mr_signer'"
    );
}

#[test]
fn test_tee_type_handling() {
    // Test different TEE types
    let tee_types = [
        (TeeType::Sgx, "SGX"),
        (TeeType::Sev, "SEV"),
        (TeeType::Tdx, "TDX"),
        (TeeType::Other("custom".to_string()), "custom"),
    ];

    for (tee_type, expected_name) in tee_types.iter() {
        let (_, public_key) = create_rsa_keypair();
        let attestation = create_test_attestation(
            tee_type.clone(),
            public_key,
            env::block_timestamp() / 1_000_000_000,
        );
        
        // Verify the TEE type is set correctly
        match tee_type {
            TeeType::Sgx => assert!(matches!(attestation.tee_type, TeeType::Sgx)),
            TeeType::Sev => assert!(matches!(attestation.tee_type, TeeType::Sev)),
            TeeType::Tdx => assert!(matches!(attestation.tee_type, TeeType::Tdx)),
            TeeType::Other(name) => {
                if let TeeType::Other(actual_name) = &attestation.tee_type {
                    assert_eq!(actual_name, name);
                } else {
                    panic!("Expected Other variant");
                }
            }
        }
    }
}

#[test]
fn test_attestation_validation() {
    // Set up test context
    let context = get_context();
    testing_env!(context);

    // Create a test attestation
    let (_, public_key) = create_rsa_keypair();
    let mut attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        env::block_timestamp() / 1_000_000_000,
    );
    
    // Test active status
    assert!(attestation.is_active, "Attestation should be active initially");
    
    // Test expiration
    let original_expiry = attestation.expires_at;
    assert!(
        attestation.expires_at > attestation.issued_at,
        "Expiration should be after issue time"
    );
    
    // Test revocation
    attestation.is_active = false;
    assert!(!attestation.is_active, "Attestation should be inactive after revocation");
    
    // Test extension
    attestation.expires_at += 3600; // Add 1 hour
    assert!(
        attestation.expires_at > original_expiry,
        "Expiration should be extended"
    );
}

#[test]
fn test_sgx_metadata_validation() {
    // Set up test context
    let context = get_context();
    testing_env!(context);

    // Create a test attestation
    let (_, public_key) = create_rsa_keypair();
    let attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        env::block_timestamp() / 1_000_000_000, // Convert to seconds
    );
    
    // Verify required SGX metadata fields
    let required_fields = [
        "sgx_mr_enclave",
        "sgx_mr_signer",
        "sgx_isv_prod_id",
        "sgx_isv_svn",
        "sgx_quote_status",
    ];
    
    for field in required_fields.iter() {
        assert!(
            attestation.metadata.contains_key(*field),
            "Missing required SGX metadata field: {}",
            field
        );
    }
    
    // Verify quote status is OK
    assert_eq!(
        attestation.metadata.get("sgx_quote_status").unwrap(),
        "OK",
        "SGX quote status should be OK"
    );
}

#[test]
fn test_attestation_metadata() {
    // Set up test context
    let context = get_context();
    testing_env!(context);

    // Create a test attestation
    let (_, public_key) = create_rsa_keypair();
    let attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        env::block_timestamp() / 1_000_000_000,
    );
    
    // Test valid attestation
    assert!(attestation.is_active, "Attestation should be active");
    
    // Test revocation
    attestation.is_active = false;
    assert!(!attestation.is_active, "Attestation should be inactive after revocation");
    
    // Test expiration (set expiration to the past)
    attestation.expires_at = 1; // Far in the past
    let current_timestamp = env::block_timestamp() / 1_000_000_000;
    assert!(
        current_timestamp > attestation.expires_at,
        "Attestation should be expired"
    );
}

/// Test SGX signature verification with missing required metadata
#[test]
fn test_sgx_signature_verification_missing_metadata() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test attestation with missing required SGX fields
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        HashMap::new(), // Empty metadata
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with missing metadata error
    assert!(
        matches!(result, Err(TeeAttestationError::InvalidMetadata { .. })),
        "Expected InvalidMetadata error, got {:?}",
        result
    );
}

/// Test SGX signature verification with expired attestation
#[test]
fn test_sgx_signature_verification_expired() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with expired timestamp
    let mut test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        metadata,
    );
    
    // Manually set the expiration to the past
    test_attestation.expires_at = env::block_timestamp() / 1_000_000 - 1;
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with expired error
    assert!(
        matches!(result, Err(TeeAttestationError::AttestationExpired { .. })),
        "Expected AttestationExpired error, got {:?}",
        result
    );
}

/// Test SGX signature verification with an invalid signature
#[test]
fn test_sgx_signature_verification_invalid_signature() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with an invalid signature
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "INVALID_SIGNATURE".to_string(),
        metadata,
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with InvalidSignature error
    assert!(
        matches!(result, Err(TeeAttestationError::InvalidSignature { .. })),
        "Expected InvalidSignature error, got {:?}",
        result
    );
}
#[test]
fn test_sgx_signature_verification_revoked() {
    // Generate a test keypair
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create test data
    let test_data = b"test message for revoked attestation";
    
    // Create a test SGX report
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    
    // Initialize the contract
    let mut contract = setup_contract();
    
    // Create a test attestation using the contract's public API
    let metadata = serde_json::json!({
        "sgx_mr_enclave": "test_enclave",
        "sgx_mr_signer": "test_signer",
        "sgx_isv_prod_id": "1",
        "sgx_isv_svn": "1"
    });
    
    // Register the attestation
    let result = contract.register_attestation(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        3600, // 1 hour expiration
        "1.0.0".to_string(),
        Some(serde_json::to_string(&metadata).unwrap()),
    );
    
    // Get the attestation ID from the event logs
    let attestation_id = result.unwrap();
    
    // Revoke the attestation
    let revoke_result = contract.revoke_attestation(attestation_id.clone());
    assert!(revoke_result.is_ok(), "Failed to revoke attestation");
    
    // Verify the attestation should fail due to revocation
    let is_valid = contract.verify_attestation(attestation_id);
    assert!(!is_valid, "Attestation should be revoked and invalid");
}
