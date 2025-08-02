use near_sdk::{
    test_utils::VMContextBuilder,
    testing_env, AccountId, Gas, NearToken, PublicKey,
};
use std::collections::HashMap;
use p256::ecdsa::{SigningKey, Signature, signature::Signer};
use rand_core::OsRng;
use near_solver::{
    tee::{
        attestation::TeeAttestation as AttestationImpl,
        TeeType,
        TeeAttestationRegistry,
        attestation::TeeType as AttestationTeeType,
        errors::TeeAttestationError
    },
    CrossChainSolverContract,
};
use near_solver::{
    tee::{
        attestation::TeeAttestation,
        TeeType,
        errors::TeeAttestationError,
    },
    CrossChainSolverContract,
};

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

// Import test utilities
use test_utils::*;

mod test_utils;

/// Helper function to create a basic valid attestation for testing
fn create_test_attestation(
    tee_type: TeeType,
    public_key: String,
    report: String,
    signature: String,
    signer_id: AccountId,
    ttl_seconds: u64,
) -> Result<AttestationImpl, near_solver::tee::TeeAttestationError> {
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

#[test]
fn test_sgx_signature_verification_basic() {
    // Setup test environment
    let context = get_context(account("test.near"), false);
    testing_env!(context);
    
    // Create test keypair and sign some data
    let (signing_key, verifying_key) = generate_test_keypair();
    let message = b"test message";
    let signature: Signature = signing_key.sign(message);
    
    // Create test attestation
    let public_key = hex::encode(verifying_key.to_encoded_point(false).as_bytes());
    let signature_str = hex::encode(signature.to_der().as_bytes());
    
    let attestation = create_test_attestation(
        TeeType::Sgx,
        public_key.clone(),
        "test_report".to_string(),
        signature_str.clone(),
        account("test.near"),
        3600, // 1 hour TTL
        None,
    ).expect("Failed to create test attestation");
    
    // Initialize contract
    let mut contract = CrossChainSolverContract::new(account("solver.near"));
    
    // Register the attestation
    contract.register_tee_attestation(
        to_attestation_tee_type(TeeType::Sgx),
        public_key.clone(),
        "test_report".to_string(),
        signature_str.clone(),
        3600,
        "1.0.0".to_string(),
        attestation.metadata,
    ).expect("Failed to register attestation");
    
    // Verify the signature
    let result = contract.verify_tee_signature(
        TeeType::Sgx,
        public_key,
        message.to_vec(),
        signature_str,
    );
    
    assert!(result.is_ok(), "Signature verification should succeed");
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
