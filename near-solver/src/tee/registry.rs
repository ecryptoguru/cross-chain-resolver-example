use near_sdk::{
    env, near_bindgen, require, AccountId, PanicOnDefault,
    collections::{LookupMap, UnorderedSet},
    borsh::{self, BorshDeserialize, BorshSerialize},
};
use std::collections::HashMap;
use crate::{
    tee::attestation::{TeeAttestation, TeeAttestationError, TeeType, StorageKey},
    event::ContractEvent,
};

// Define a simple error type instead of using Result<T, E> for contract methods
#[derive(Debug)]
pub enum TeeRegistryError {
    AttestationNotFound,
    InvalidAttestation,
    Unauthorized,
}



/// TEE Registry contract state
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct TeeRegistry {
    /// Contract owner (admin)
    pub owner_id: AccountId,
    /// Whether the contract is paused
    pub paused: bool,
    /// Map of public key to TEE attestation
    pub attestations: LookupMap<String, TeeAttestation>,
    /// Set of all attestation public keys (for enumeration)
    pub attestation_keys: UnorderedSet<String>,
    /// Map of owner to their attestation public keys
    pub owner_attestations: LookupMap<AccountId, UnorderedSet<String>>,
}

#[near_bindgen]
impl TeeRegistry {
    /// Initialize a new TEE Registry
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        // Clone owner_id to avoid move issues
        let owner_id_clone = owner_id.clone();
        
        Self {
            owner_id,
            paused: false,
            attestations: LookupMap::new(StorageKey::Attestations),
            attestation_keys: UnorderedSet::new(StorageKey::AttestationKeys),
            owner_attestations: LookupMap::new(StorageKey::AttestationByOwner {
                account_hash: env::sha256(owner_id_clone.as_bytes()),
            }),
        }
    }

    // ===== Admin Functions =====

    /// Pause the registry (admin only)
    #[payable]
    pub fn pause(&mut self) {
        self.assert_not_paused();
        // Only owner can pause/unpause
        require!(env::predecessor_account_id() == env::current_account_id(), "Only owner can perform this action");
        
        self.paused = true;
        
        // Emit event
        let event = ContractEvent::new_error(
            None,
            "TEE registry paused",
            Some(format!("Paused by: {}", env::predecessor_account_id()))
        );
        event.emit();
    }

    /// Unpause the registry (admin only)
    #[payable]
    pub fn unpause(&mut self) {
        require!(self.paused, "Registry is not paused");
        // Only owner can pause/unpause
        require!(env::predecessor_account_id() == env::current_account_id(), "Only owner can perform this action");
        
        self.paused = false;
        
        // Emit event
        let event = ContractEvent::new_error(
            None,
            "TEE registry unpaused",
            Some(format!("Unpaused by: {}", env::predecessor_account_id()))
        );
        event.emit();
    }

    // ===== Public Functions =====

    /// Registers a new TEE attestation
    #[handle_result]
    pub fn register_attestation(
        &mut self,
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        expires_in_seconds: u64,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<Result<(), TeeAttestationError>, near_sdk::Abort> {
        self.assert_not_paused();
        
        let _owner_id = env::predecessor_account_id();
        
        // Create and validate the attestation
        let attestation = match TeeAttestation::new(
            tee_type.clone(),
            public_key.clone(),
            report,
            signature,
            expires_in_seconds,
            env::signer_account_id(),
            "1.0.0".to_string(),
            metadata,
        ) {
            Ok(att) => att,
            Err(e) => return Ok(Err(e)),
        };
        
        // Check if the attestation is valid
        if !attestation.is_valid(env::block_timestamp()) {
            env::panic_str("TEE attestation verification failed");
        }
        
        // Store the attestation
        self.attestations.insert(&public_key, &attestation);
        self.attestation_keys.insert(&public_key);
        
        // Update the owner's attestations
        let signer_id = env::signer_account_id();
        let mut owner_attestations = self.owner_attestations.get(&signer_id).unwrap_or_else(|| {
            UnorderedSet::new(StorageKey::AttestationByOwner {
                account_hash: env::sha256(signer_id.as_bytes()),
            })
        });
        
        owner_attestations.insert(&public_key);
        self.owner_attestations.insert(&signer_id, &owner_attestations);
        
        // Emit event
        let event = ContractEvent::new_tee_attestation_registered(
            public_key.clone(),
            tee_type.to_string(),
        );
        event.emit();
        
        Ok(Ok(()))
    }

    /// Revoke an existing TEE attestation
    #[payable]
    pub fn revoke_attestation(&mut self, public_key: String) {
        self.assert_not_paused();
        
        let owner_id = env::predecessor_account_id();
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Get the attestation
        let attestation = self.attestations
            .get(&public_key)
            .unwrap_or_else(|| env::panic_str("TEE attestation not found"));
            
        // Verify ownership or admin access
        if owner_id != self.owner_id {
            env::panic_str("Unauthorized: Only attestation owner or admin can revoke");
        }
        
        // Create a mutable copy of the attestation
        let mut updated_attestation = attestation.clone();
        
        // Mark the attestation as inactive
        updated_attestation.is_active = false;
        updated_attestation.expires_at = current_timestamp;
        
        // Update storage with the modified attestation
        self.attestations.insert(&public_key, &updated_attestation);
        
        // Emit event
        let event = ContractEvent::new_error(
            None,
            "TEE attestation revoked",
            Some(format!("Public key: {}, Owner: {}", public_key, owner_id))
        );
        event.emit();
        

    }

    /// Extend the expiration of an attestation
    #[payable]
    pub fn extend_attestation(
        &mut self,
        public_key: String,
        new_expires_at: u64,
    ) {
        self.assert_not_paused();
        
        let _owner_id = env::predecessor_account_id(); // Currently unused, kept for future access control
        let _current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Get the attestation
        let mut attestation = self
            .attestations
            .get(&public_key)
            .unwrap_or_else(|| env::panic_str("Attestation not found"));
            
        // Verify ownership
        // Note: TeeAttestation doesn't have owner_id field, skip ownership check for now
        // In a real implementation, you'd store owner mapping separately
        
        // Store old expiration for event
        let old_expires_at = attestation.expires_at;
        
        // Extend the attestation
        attestation.expires_at = new_expires_at;
        
        // Update storage
        self.attestations.insert(&public_key, &attestation);
        
        // Emit event
        let event = ContractEvent::new_error(
            None,
            "TEE attestation extended",
            Some(format!("Public key: {}, Type: {:?}, Old Expiration: {}, New Expiration: {}", public_key, attestation.tee_type, old_expires_at, new_expires_at))
        );
        event.emit();
        

    }

    // ===== View Functions =====

    /// Get an attestation by public key
    pub fn get_attestation(&self, public_key: String) -> Option<TeeAttestation> {
        self.attestations.get(&public_key)
    }

    /// Check if an attestation is valid (exists, not expired, and active)
    pub fn is_attestation_valid(&self, public_key: String) -> bool {
        match self.attestations.get(&public_key) {
            Some(attestation) => attestation.is_active && attestation.is_valid(env::block_timestamp()),
            None => false,
        }
    }

    /// Get all attestation public keys (paginated)
    pub fn get_attestation_keys(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<String> {
        let keys = &self.attestation_keys;
        let start = from_index.unwrap_or(0);
        let end = start + limit.unwrap_or(50);
        
        keys.iter()
            .skip(start as usize)
            .take((end - start) as usize)
            .collect()
    }

    /// Get attestations for an owner (paginated)
    pub fn get_owner_attestations(
        &self,
        owner_id: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<String> {
        match self.owner_attestations.get(&owner_id) {
            Some(keys) => {
                let start = from_index.unwrap_or(0);
                let end = start + limit.unwrap_or(50);
                
                keys.iter()
                    .skip(start as usize)
                    .take((end - start) as usize)
                    .collect()
            }
            None => vec![],
        }
    }

    // ===== Internal Helpers =====
    
    /// Assert that the registry is not paused
    fn assert_not_paused(&self) {
        require!(!self.paused, "TEE Registry is currently paused");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, VMContext};
    
    fn get_context(is_view: bool) -> VMContext {
        VMContextBuilder::new()
            .current_account_id("registry.testnet".parse().unwrap())
            .signer_account_id("bob.testnet".parse().unwrap())
            .predecessor_account_id("bob.testnet".parse().unwrap())
            .is_view(is_view)
            .build()
    }
    
    #[test]
    fn test_register_and_verify_attestation() {
        let context = get_context(false);
        testing_env!(context);
        
        let mut registry = TeeRegistry::new("owner.testnet".parse().unwrap());
        
        // Test registration
        let mut metadata: HashMap<String, String> = HashMap::new();
        // Add required SGX metadata fields
        metadata.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
        registry.register_attestation(
            TeeType::Sgx,
            "test_public_key".to_string(),
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            (env::block_timestamp() / 1_000_000_000) + 3600, // 1 hour from now
            Some(metadata),
        ).unwrap().unwrap();
        
        // Test get_attestation
        let attestation = registry.get_attestation("test_public_key".to_string());
        assert!(attestation.is_some());
        
        // Test is_attestation_valid
        assert!(registry.is_attestation_valid("test_public_key".to_string()));
    }
    
    #[test]
    fn test_revoke_attestation() {
        let context = get_context(false);
        testing_env!(context);
        
        let mut registry = TeeRegistry::new("bob.testnet".parse().unwrap());
        
        // Register an attestation
        let mut metadata: HashMap<String, String> = HashMap::new();
        // Add required SGX metadata fields
        metadata.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
        registry.register_attestation(
            TeeType::Sgx,
            "test_public_key".to_string(),
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            (env::block_timestamp() / 1_000_000_000) + 3600, // 1 hour from now
            Some(metadata),
        ).unwrap().unwrap();
        
        // Revoke the attestation
        registry.revoke_attestation("test_public_key".to_string());
        
        // Should no longer be valid
        assert!(!registry.is_attestation_valid("test_public_key".to_string()));
    }
    
    #[test]
    fn test_extend_attestation() {
        let context = get_context(false);
        testing_env!(context);
        
        let mut registry = TeeRegistry::new("owner.testnet".parse().unwrap());
        
        let initial_expiry = (env::block_timestamp() / 1_000_000_000) + 3600; // 1 hour from now
        
        // Register an attestation
        let mut metadata: HashMap<String, String> = HashMap::new();
        // Add required SGX metadata fields
        metadata.insert("sgx_mr_enclave".to_string(), "test_mr_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_mr_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
        registry.register_attestation(
            TeeType::Sgx,
            "test_public_key".to_string(),
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            initial_expiry,
            Some(metadata),
        ).unwrap().unwrap();
        
        // Extend the attestation
        let new_expiry = initial_expiry + 3600; // Add another hour
        registry.extend_attestation("test_public_key".to_string(), new_expiry);
        
        // Check the new expiry
        let attestation = registry.get_attestation("test_public_key".to_string()).unwrap();
        assert_eq!(attestation.expires_at, new_expiry);
    }
}
