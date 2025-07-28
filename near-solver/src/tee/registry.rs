use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::{LookupMap, UnorderedSet},
    env, near_bindgen, require,
    serde::{Deserialize, Serialize},
    AccountId, BorshStorageKey, PanicOnDefault, Promise,
};

use crate::{
    error::ContractError,
    event::ContractEvent,
    model::tee::{TeeAttestation, TeeType},
    require_admin, Contract, ContractExt,
};

/// Storage keys for the TEE registry
#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    Attestations,
    OwnerAttestations { account_hash: Vec<u8> },
    AttestationKeys,
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
        Self {
            owner_id,
            paused: false,
            attestations: LookupMap::new(StorageKey::Attestations),
            attestation_keys: UnorderedSet::new(StorageKey::AttestationKeys),
            owner_attestations: LookupMap::new(StorageKey::Attestations),
        }
    }

    // ===== Admin Functions =====

    /// Pause the registry (admin only)
    #[payable]
    pub fn pause(&mut self) {
        self.assert_not_paused();
        require_admin!();
        
        self.paused = true;
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_registry_paused(&env::predecessor_account_id()) {
            event.emit();
        }
    }

    /// Unpause the registry (admin only)
    #[payable]
    pub fn unpause(&mut self) {
        require!(self.paused, "Registry is not paused");
        require_admin!();
        
        self.paused = false;
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_registry_unpaused(&env::predecessor_account_id()) {
            event.emit();
        }
    }

    // ===== Public Functions =====

    /// Register a new TEE attestation
    #[payable]
    pub fn register_attestation(
        &mut self,
        public_key: String,
        tee_type: TeeType,
        metadata: String,
        signature: String,
        expires_at: u64,
    ) -> Result<(), ContractError> {
        self.assert_not_paused();
        
        let owner_id = env::predecessor_account_id();
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Create and validate the attestation
        let attestation = TeeAttestation::new(
            public_key.clone(),
            tee_type,
            owner_id.clone(),
            metadata,
            signature,
            current_timestamp,
            expires_at,
        )?;
        
        // Verify the attestation
        attestation.verify()?;
        
        // Store the attestation
        self.attestations.insert(&public_key, &attestation);
        self.attestation_keys.insert(&public_key);
        
        // Update owner's attestations
        let mut owner_attestations = self
            .owner_attestations
            .get(&owner_id)
            .unwrap_or_else(|| UnorderedSet::new(StorageKey::OwnerAttestations {
                account_hash: env::sha256(owner_id.as_bytes()),
            }));
            
        owner_attestations.insert(&public_key);
        self.owner_attestations.insert(&owner_id, &owner_attestations);
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_attestation_created(
            &public_key,
            &attestation.tee_type.to_string(),
            &owner_id.to_string(),
            expires_at,
        ) {
            event.emit();
        }
        
        Ok(())
    }

    /// Revoke an existing TEE attestation
    #[payable]
    pub fn revoke_attestation(&mut self, public_key: String) -> Result<(), ContractError> {
        self.assert_not_paused();
        
        let owner_id = env::predecessor_account_id();
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Get the attestation
        let mut attestation = self
            .attestations
            .get(&public_key)
            .ok_or(ContractError::AttestationNotFound)?;
            
        // Verify ownership or admin access
        if owner_id != attestation.owner_id && owner_id != self.owner_id {
            return Err(ContractError::Unauthorized);
        }
        
        // Mark as revoked
        attestation.revoke(current_timestamp)?;
        
        // Update storage
        self.attestations.insert(&public_key, &attestation);
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_attestation_revoked(
            &public_key,
            &attestation.tee_type.to_string(),
            &attestation.owner_id.to_string(),
            current_timestamp,
        ) {
            event.emit();
        }
        
        Ok(())
    }

    /// Extend the expiration of an attestation
    #[payable]
    pub fn extend_attestation(
        &mut self,
        public_key: String,
        new_expires_at: u64,
    ) -> Result<(), ContractError> {
        self.assert_not_paused();
        
        let owner_id = env::predecessor_account_id();
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Get the attestation
        let mut attestation = self
            .attestations
            .get(&public_key)
            .ok_or(ContractError::AttestationNotFound)?;
            
        // Verify ownership
        if owner_id != attestation.owner_id {
            return Err(ContractError::Unauthorized);
        }
        
        // Store old expiration for event
        let old_expires_at = attestation.expires_at;
        
        // Extend the attestation
        attestation.extend(new_expires_at, current_timestamp)?;
        
        // Update storage
        self.attestations.insert(&public_key, &attestation);
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_attestation_extended(
            &public_key,
            &attestation.tee_type.to_string(),
            &owner_id.to_string(),
            old_expires_at,
            new_expires_at,
        ) {
            event.emit();
        }
        
        Ok(())
    }

    // ===== View Functions =====

    /// Get an attestation by public key
    pub fn get_attestation(&self, public_key: String) -> Option<TeeAttestation> {
        self.attestations.get(&public_key)
    }

    /// Check if an attestation is valid (exists, not expired, not revoked)
    pub fn is_attestation_valid(&self, public_key: String) -> bool {
        match self.attestations.get(&public_key) {
            Some(attestation) => attestation.is_valid(env::block_timestamp() / 1_000_000_000),
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
        let result = registry.register_attestation(
            "test_public_key".to_string(),
            TeeType::Sgx,
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            (env::block_timestamp() / 1_000_000_000) + 3600, // 1 hour from now
        );
        
        assert!(result.is_ok());
        
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
        
        let mut registry = TeeRegistry::new("owner.testnet".parse().unwrap());
        
        // Register an attestation
        registry.register_attestation(
            "test_public_key".to_string(),
            TeeType::Sgx,
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            (env::block_timestamp() / 1_000_000_000) + 3600, // 1 hour from now
        ).unwrap();
        
        // Revoke the attestation
        let result = registry.revoke_attestation("test_public_key".to_string());
        assert!(result.is_ok());
        
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
        registry.register_attestation(
            "test_public_key".to_string(),
            TeeType::Sgx,
            r#"{"enclave_quote":"test_quote"}"#.to_string(),
            "test_signature".to_string(),
            initial_expiry,
        ).unwrap();
        
        // Extend the attestation
        let new_expiry = initial_expiry + 3600; // Add another hour
        let result = registry.extend_attestation("test_public_key".to_string(), new_expiry);
        assert!(result.is_ok());
        
        // Check the new expiry
        let attestation = registry.get_attestation("test_public_key".to_string()).unwrap();
        assert_eq!(attestation.expires_at, new_expiry);
    }
}
