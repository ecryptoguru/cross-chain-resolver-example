//! TEE Attestation Registry Implementation
//!
//! This module provides the main registry implementation for managing TEE attestations,
//! including registration, verification, revocation, and administrative functions.

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, near_bindgen, AccountId,
    collections::{LookupMap, UnorderedSet},
};
use std::collections::HashMap;

use super::{
    types::TeeType,
    errors::TeeAttestationError,
    attestation_data::TeeAttestation,
    storage::StorageKey,
};

/// Registry of trusted TEE attestations
#[derive(BorshDeserialize, BorshSerialize)]
pub struct TeeAttestationRegistry {
    /// Mapping of public key to attestation
    pub attestations: LookupMap<String, TeeAttestation>,
    /// Set of all attestation public keys for iteration
    pub attestation_keys: UnorderedSet<String>,
    /// Mapping of owner to their attestation public keys
    pub attestations_by_owner: LookupMap<AccountId, UnorderedSet<String>>,
    /// Admin account that can manage the registry
    pub admin: AccountId,
    /// Whether the registry is paused
    pub is_paused: bool,
}

impl TeeAttestationRegistry {
    /// Initializes a new TEE attestation registry with the given admin
    pub fn new(admin: AccountId) -> Self {
        // Initialize storage keys
        let attestations_key = StorageKey::Attestations;
        let attestation_keys_key = StorageKey::AttestationKeys;
        
        Self {
            attestations: LookupMap::new(attestations_key),
            attestation_keys: UnorderedSet::new(attestation_keys_key),
            attestations_by_owner: LookupMap::new(StorageKey::OwnerAttestations {
                account_hash: env::sha256(admin.as_bytes())
            }),
            admin,
            is_paused: false,
        }
    }
}

impl Default for TeeAttestationRegistry {
    fn default() -> Self {
        Self::new(env::current_account_id())
    }
}

impl TeeAttestationRegistry {
    
    /// Registers a new TEE attestation

    pub fn register_attestation(
        &mut self,
        public_key: String,
        tee_type: TeeType,
        report: String,
        signature: String,
        expires_in_seconds: u64,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<TeeAttestation, TeeAttestationError> {
        // Ensure registry is not paused
        self.ensure_not_paused()?;
        
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        // Check if attestation already exists
        if self.attestations.contains_key(&public_key) {
            return Err(TeeAttestationError::AlreadyExists { 
                public_key: public_key.clone() 
            });
        }
        
        let signer_id = env::signer_account_id();
        
        // Create new attestation
        let attestation = TeeAttestation::new(
            tee_type,
            public_key.clone(),
            report,
            signature,
            signer_id.clone(),
            expires_in_seconds,
            metadata,
        )?;
        
        // Store the attestation
        self.attestations.insert(&public_key, &attestation);
        self.attestation_keys.insert(&public_key);
        
        // Update owner mapping
        let mut owner_attestations = self.attestations_by_owner
            .get(&signer_id)
            .unwrap_or_else(|| {
                UnorderedSet::new(StorageKey::AttestationByOwner {
                    account_hash: env::sha256(signer_id.as_bytes())
                })
            });
        owner_attestations.insert(&public_key);
        self.attestations_by_owner.insert(&signer_id, &owner_attestations);
        
        Ok(attestation)
    }
    
    /// Gets an attestation by public key
    pub fn get_attestation(&self, public_key: String) -> Option<TeeAttestation> {
        self.attestations.get(&public_key)
    }
    
    /// Gets all attestation public keys (paginated)
    pub fn get_attestation_keys(
        &self, 
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<String> {
        let from_index = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100); // Cap at 100
        
        self.attestation_keys
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .collect()
    }
    
    /// Gets attestations for a specific owner (paginated)
    pub fn get_attestations_by_owner(
        &self,
        owner_id: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<TeeAttestation> {
        let from_index = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100); // Cap at 100
        
        if let Some(owner_keys) = self.attestations_by_owner.get(&owner_id) {
            owner_keys
                .iter()
                .skip(from_index as usize)
                .take(limit as usize)
                .filter_map(|key| self.attestations.get(&key))
                .collect()
        } else {
            Vec::new()
        }
    }
    
    /// Revokes a TEE attestation

    pub fn revoke_attestation(&mut self, public_key: String) -> Result<(), TeeAttestationError> {
        // Ensure registry is not paused
        self.ensure_not_paused()?;
        
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        // Get and revoke the attestation
        let mut attestation = self.attestations.get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.revoke()?;
        
        // Update the stored attestation
        self.attestations.insert(&public_key, &attestation);
        
        Ok(())
    }
    
    /// Extends the expiration of a TEE attestation

    pub fn extend_attestation(
        &mut self,
        public_key: String,
        additional_seconds: u64,
    ) -> Result<TeeAttestation, TeeAttestationError> {
        // Ensure registry is not paused
        self.ensure_not_paused()?;
        
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        // Get and extend the attestation
        let mut attestation = self.attestations.get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.extend_expiration(additional_seconds)?;
        
        // Update the stored attestation
        self.attestations.insert(&public_key, &attestation);
        
        Ok(attestation)
    }
    
    /// Updates the metadata of an attestation

    pub fn update_attestation_metadata(
        &mut self,
        public_key: String,
        new_metadata: HashMap<String, String>,
    ) -> Result<(), TeeAttestationError> {
        // Ensure registry is not paused
        self.ensure_not_paused()?;
        
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        // Get and update the attestation
        let mut attestation = self.attestations.get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.update_metadata(new_metadata)?;
        
        // Update the stored attestation
        self.attestations.insert(&public_key, &attestation);
        
        Ok(())
    }
    
    /// Pauses the registry (admin only)

    pub fn pause(&mut self) -> Result<(), TeeAttestationError> {
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        if self.is_paused {
            return Err(TeeAttestationError::Paused);
        }
        
        self.is_paused = true;
        Ok(())
    }
    
    /// Unpauses the registry (admin only)

    pub fn unpause(&mut self) -> Result<(), TeeAttestationError> {
        // Ensure caller is admin
        self.ensure_caller_is_admin()?;
        
        if !self.is_paused {
            return Err(TeeAttestationError::NotPaused);
        }
        
        self.is_paused = false;
        Ok(())
    }
    
    /// Verifies a TEE attestation is valid

    pub fn verify_attestation(
        &self,
        public_key: String,
        verify_signature: bool,
    ) -> Result<bool, TeeAttestationError> {
        // Get attestation
        let attestation = self.attestations.get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Validate attestation
        attestation.validate(current_timestamp, verify_signature)?;
        
        Ok(true)
    }
    
    /// Internal: Ensures the registry is not paused
    fn ensure_not_paused(&self) -> Result<(), TeeAttestationError> {
        if self.is_paused {
            return Err(TeeAttestationError::Paused);
        }
        Ok(())
    }
    
    /// Internal: Ensures the caller is the admin
    fn ensure_caller_is_admin(&self) -> Result<(), TeeAttestationError> {
        if env::signer_account_id() != self.admin {
            return Err(TeeAttestationError::Unauthorized {
                caller: env::signer_account_id(),
                required: "admin".to_string(),
            });
        }
        Ok(())
    }
}
