use near_sdk::{
    test_utils::VMContextBuilder,
    testing_env, AccountId, Gas, NearToken, PublicKey,
};
use std::collections::HashMap;
use p256::ecdsa::{SigningKey, Signature, signature::Signer};
use rand_core::OsRng;
use near_solver::{
    tee::{
        attestation::{TeeAttestation, TeeAttestationError, TeeType as AttestationTeeType},
        TeeType,
        registry::TeeAttestationRegistry,
    },
    CrossChainSolverContract,
};
use base64::Engine as _;
use std::str::FromStr;
use near_sdk::json_types::Base64VecU8;

// Import test utilities
mod test_utils {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use near_sdk::VMContext;
    use p256::ecdsa::{SigningKey, Signature, signature::Signer};
    use rand_core::OsRng;
    use hex;

    // Helper function to create a test account
    fn account(name: &str) -> AccountId {
        name.parse().unwrap_or_else(|_| panic!("Invalid account ID: {}", name))
    }
    
    // Helper to convert TeeType to AttestationTeeType
    fn to_attestation_tee_type(tee_type: TeeType) -> AttestationTeeType {
        match tee_type {
            TeeType::Sgx => AttestationTeeType::Sgx,
            TeeType::Sev => AttestationTeeType::Sev,
            TeeType::TrustZone => AttestationTeeType::TrustZone,
            TeeType::AwsNitro => AttestationTeeType::AwsNitro,
            TeeType::Azure => AttestationTeeType::Azure,
            TeeType::Asylo => AttestationTeeType::Asylo,
            TeeType::Other => AttestationTeeType::Other,
        }
    }

    /// Helper function to generate a test ECDSA keypair
    pub fn generate_ecdsa_keypair() -> (SigningKey, String, String) {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let public_key = hex::encode(verifying_key.to_encoded_point(false).as_bytes());
        let private_key_hex = hex::encode(signing_key.to_bytes());
        (signing_key, public_key, private_key_hex)
    }

    /// Helper function to create a test SGX report
    pub fn create_test_sgx_report(data: &[u8], private_key: &SigningKey) -> (String, String) {
        let signature: Signature = private_key.sign(data);
        let signature_hex = hex::encode(signature.to_der().as_bytes());
        let report = format!("SGX_REPORT:{}:{}", hex::encode(data), signature_hex);
        (report, signature_hex)
    }

    /// Helper function to create a test attestation
    pub fn create_test_attestation(
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        signer_id: AccountId,
        ttl_seconds: u64,
    ) -> TeeAttestation {
        create_test_attestation_with_metadata(
            tee_type,
            public_key,
            report,
            signature,
            signer_id,
            ttl_seconds,
            None,
        )
    }

    /// Helper function to create a test attestation with custom metadata
    pub fn create_test_attestation(
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        signer_id: AccountId,
        ttl_seconds: u64,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<AttestationImpl, TeeAttestationError> {
        // Convert between TeeType variants if needed
        let tee_type = to_attestation_tee_type(tee_type);
        
        // Use provided metadata or create default SGX metadata
        let metadata = metadata.unwrap_or_else(|| {
            let mut m = HashMap::new();
            m.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
            m.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
            m.insert("sgx_isv_prod_id".to_string(), "0".to_string());
            m.insert("sgx_isv_svn".to_string(), "0".to_string());
            m
        });
        
        AttestationImpl::new(
            tee_type,
            public_key,
            report,
            signature,
            ttl_seconds,
            signer_id,
            "1.0.0".to_string(),
            metadata,
        )
    }
    
    // Helper function to create a test context
    fn get_context(signer_id: AccountId, is_view: bool) -> near_sdk::VMContext {
        let mut builder = VMContextBuilder::new();
        
        builder
            .current_account_id(account("solver.near"))
            .signer_account_id(signer_id.clone())
            .predecessor_account_id(signer_id)
            .block_timestamp(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() * 1_000_000_000,
            )
            .account_balance(NearToken::from_yoctonear(0))
            .account_locked_balance(NearToken::from_yoctonear(0))
            .storage_usage(0)
            .attached_deposit(NearToken::from_yoctonear(0))
            .prepaid_gas(Gas::from_tgas(300))
            .signer_account_pk(PublicKey::empty(near_sdk::env::sig_ed25519_version()))
            .is_view(is_view)
            .build()
    }
    }
}

mod test_utils {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use p256::ecdsa::{SigningKey, Signature, signature::Signer};
    use rand_core::OsRng;
    use hex;
    use base64::Engine as _;
    use std::collections::HashMap;

    // Helper function to create a test account
    pub fn account(name: &str) -> AccountId {
        name.parse().unwrap_or_else(|_| panic!("Invalid account ID: {}", name))
    }
    
    // Helper to convert TeeType to AttestationTeeType
    pub fn to_attestation_tee_type(tee_type: TeeType) -> AttestationTeeType {
        match tee_type {
            TeeType::Sgx => AttestationTeeType::Sgx,
            TeeType::Sev => AttestationTeeType::Sev,
            TeeType::TrustZone => AttestationTeeType::TrustZone,
            TeeType::AwsNitro => AttestationTeeType::AwsNitro,
            TeeType::Azure => AttestationTeeType::Azure,
            TeeType::Asylo => AttestationTeeType::Asylo,
            TeeType::Other => AttestationTeeType::Other,
        }
    }

    /// Helper function to generate a test ECDSA keypair
    pub fn generate_ecdsa_keypair() -> (SigningKey, String, String) {
        let signing_key = SigningKey::random(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let public_key = hex::encode(verifying_key.to_encoded_point(false).as_bytes());
        let private_key_hex = hex::encode(signing_key.to_bytes());
        (signing_key, public_key, private_key_hex)
    }

    /// Helper function to create a test SGX report
    pub fn create_test_sgx_report(data: &[u8], private_key: &SigningKey) -> (String, String) {
        let signature: Signature = private_key.sign(data);
        let signature_hex = hex::encode(signature.to_der().as_bytes());
        let report = format!("SGX_REPORT:{}:{}", hex::encode(data), signature_hex);
        (report, signature_hex)
    }

    // Helper function to create a test context
    pub fn get_context(signer_id: AccountId, is_view: bool) -> near_sdk::VMContext {
        let mut builder = VMContextBuilder::new();
        
        builder
            .current_account_id(account("solver.near"))
            .signer_account_id(signer_id.clone())
            .predecessor_account_id(signer_id)
            .block_timestamp(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() * 1_000_000_000,
            )
            .account_balance(NearToken::from_yoctonear(0))
            .account_locked_balance(NearToken::from_yoctonear(0))
            .storage_usage(0)
            .attached_deposit(NearToken::from_yoctonear(0))
            .prepaid_gas(Gas::from_tgas(300))
            .signer_account_pk(PublicKey::empty(near_sdk::env::sig_ed25519_version()))
            .is_view(is_view)
            .build()
    }
}

// Re-export test utilities for convenience
use test_utils::*;

// Helper function to create a test attestation with SGX metadata
fn create_sgx_attestation(signing_key: &SigningKey, public_key: &str, ttl_seconds: u64) -> (String, String, HashMap<String, String>, String) {
    // Create SGX report data
    let report_data = b"SGX_REPORT_DATA";
    let signature: Signature = signing_key.sign(report_data);
    let signature_hex = hex::encode(signature.to_der().as_bytes());
    
    // Format the SGX report
    let report = format!(
        "SGX_REPORT:{}:{}",
        hex::encode(report_data),
        signature_hex
    );
    
    // Create SGX-specific metadata
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "0".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "0".to_string());
    
    (public_key.to_string(), report, metadata, signature_hex)
}

#[test]
fn test_sgx_signature_verification_basic() {
    // Setup test environment
    let context = get_context(account("test.near"), false);
    testing_env!(context);
    
    // Create test keypair
    let (signing_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create the contract instance
    let mut contract = CrossChainSolverContract::new(account("owner.near"));
    
    // Create test attestation data
    let (public_key, report, metadata, signature) = create_sgx_attestation(&signing_key, &public_key, 3600);
    
    // Convert public key to Base64VecU8 for the contract
    let public_key_bytes = hex::decode(&public_key).expect("Invalid public key hex");
    let public_key_base64 = base64::engine::general_purpose::STANDARD.encode(&public_key_bytes);
    
    // Register the attestation
    let result = contract.register_attestation(
        public_key_base64.clone(),
        TeeType::Sgx,
        report.clone(),
        signature.clone(),
        3600,
        Some(metadata.clone())
    );
    
    // Verify the attestation was registered successfully
    assert!(result.is_ok(), "Failed to register attestation: {:?}", result.err());
    
    // Verify the attestation is valid
    let verification = contract.verify_attestation(public_key_base64.clone(), true);
    assert!(verification.is_ok(), "Attestation verification failed: {:?}", verification);
    assert!(verification.unwrap(), "Attestation should be valid");
    
    // Test with invalid signature
    let invalid_result = contract.register_attestation(
        public_key_base64,
        TeeType::Sgx,
        report,
        "invalid_signature".to_string(),
        3600,
        Some(metadata)
    );
    
    // Should fail with invalid signature error
    assert!(invalid_result.is_err(), "Expected error for invalid signature");
    let verification_result = contract.verify_tee_signature(
        TeeType::Sgx,
        public_key,
        report_data.to_vec(),
        signature_str,
    );
    
    match verification_result {
        Ok(is_valid) => assert!(is_valid, "Signature verification should return true for valid signature"),
        Err(e) => panic!("Signature verification failed: {:?}", e),
    }
    metadata.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let attestation = create_test_attestation(
        TeeType::Sgx,
        public_key.clone(),
        report.clone(),
        signature_str.clone(),
        account("test.near"),
        3600, // 1 hour TTL
        Some(metadata.clone()),
        Some("1.0.0".to_string()),
    ).expect("Failed to create test attestation");
    
    // Initialize contract
    let mut contract = CrossChainSolverContract::new(account("solver.near"));
    
    // Register the attestation
    contract.register_tee_attestation(
        to_attestation_tee_type(TeeType::Sgx),
        public_key.clone(),
        report,
        signature_str.clone(),
        3600,
        "1.0.0".to_string(),
        metadata,
    ).expect("Failed to register attestation");
    
    // Verify the signature
    let result = contract.verify_tee_signature(
        to_attestation_tee_type(TeeType::Sgx),
        public_key,
        report_data.to_vec(),
        signature_str,
    );
    
    match result {
        Ok(is_valid) => assert!(is_valid, "Signature should be valid"),
        Err(e) => panic!("Signature verification failed: {:?}", e),
    }
}

#[test]
fn test_dispatcher_routes_correctly() {
    // Set up test context
    let context = VMContextBuilder::new()
        .signer_account_id(account("alice.near"))
        .predecessor_account_id(account("alice.near"))
        .is_view(false)
        .build();
    testing_env!(context);

    let mut registry = TeeAttestationRegistry::default();
    
    // Test error handling for unsupported TEE types
    #[test]
    fn test_unsupported_tee_type() {
        // Setup test environment
        let context = get_context(account("test.near"), false);
        testing_env!(context);
        
        // Initialize contract and registry
        let contract = CrossChainSolverContract::new(account("solver.near"));
        let registry = TeeAttestationRegistry::default();
        
        // Try to verify with unsupported TEE type
        let result = contract.verify_tee_signature(
            TeeType::Other, // Unsupported type
            "test_public_key".to_string(),
            b"test message".to_vec(),
            "test_signature".to_string(),
        );
        
        assert!(
            result.is_err(),
            "Should return an error for unsupported TEE type"
        );
        
        // Verification should also fail for unsupported TEE type
        let verify_result = registry.verify_attestation("test_public_key".to_string());
        assert!(
            verify_result.is_err(),
            "Verification should fail for unsupported TEE type"
        );
    }
}

#[test]
fn test_attestation_expiration_extension() {
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    let test_data = b"test message for attestation";
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    let mut attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        account("test.near"),
        3600, // 1 hour expiration
    );
    
    let original_expiry = attestation.expires_at;
    
    // Extend by 1 hour
    attestation.extend_expiration(3600).unwrap();
    assert_eq!(attestation.expires_at, original_expiry + 3600);
    
    // Test extending a revoked attestation
    attestation.revoke().unwrap();
    let result = attestation.extend_expiration(3600);
    assert!(matches!(
        result,
        Err(TeeAttestationError::Revoked { .. })
    ));
}

#[test]
fn test_attestation_revocation() {
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    let test_data = b"test message for attestation";
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    let mut attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        account("test.near"),
        3600, // 1 hour expiration
    );
    
    assert!(attestation.is_active);
    attestation.revoke().unwrap();
    assert!(!attestation.is_active);
    
    // Test double revocation
    let result = attestation.revoke();
    assert!(matches!(
        result,
        Err(TeeAttestationError::Revoked { .. })
    ));
}

#[test]
fn test_attestation_metadata_update() {
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    let test_data = b"test message for attestation";
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    let mut attestation = create_test_attestation(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        account("test.near"),
        3600, // 1 hour expiration
    );
    
    let mut new_metadata = HashMap::new();
    new_metadata.insert("new_key".to_string(), "new_value".to_string());
    
    attestation.update_metadata(new_metadata.clone()).unwrap();
    assert_eq!(attestation.metadata.get("new_key"), Some(&"new_value".to_string()));
    
    // Test updating a revoked attestation
    attestation.revoke().unwrap();
    let result = attestation.update_metadata(HashMap::new());
    assert!(matches!(
        result,
        Err(TeeAttestationError::Revoked { .. })
    ));
}
