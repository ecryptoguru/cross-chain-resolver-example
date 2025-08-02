//! Storage key definitions for TEE attestation registry
//!
//! This module defines the storage keys used by the TEE attestation registry
//! for efficient and organized data storage on the NEAR blockchain.

use near_sdk::{
    borsh::{self, BorshSerialize},
    BorshStorageKey,
};

/// Key for storing TEE attestations in the registry
#[derive(BorshSerialize, BorshStorageKey)]
pub enum StorageKey {
    /// Storage key for the main registry
    TeeAttestationRegistry,
    /// Storage key for the attestations map
    Attestations,
    /// Storage key for the attestation keys set
    AttestationKeys,
    /// Storage key for owner-specific attestations
    OwnerAttestations { 
        /// The account hash used for storage key
        account_hash: Vec<u8>
    },
    /// Storage key for attestations by owner (legacy name)
    AttestationByOwner {
        /// The account hash used for storage key
        account_hash: Vec<u8>
    },
    /// Storage key for the paused state
    Paused,
}
