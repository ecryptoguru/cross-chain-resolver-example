//! TEE (Trusted Execution Environment) module
//! 
//! This module provides functionality for working with TEE attestations
//! and managing a registry of trusted TEE attestations.

// Define the submodules
pub mod types;
pub mod registry;
pub mod attestation;

// Re-export the main TEE attestation types and traits
pub use attestation::{
    TeeType,
    TeeAttestation,
    TeeAttestationError,
    TeeAttestationRegistry,
};

// Re-export registry types
pub use registry::{
    TeeRegistry,
    TeeRegistryError,
};

// Re-export storage key from attestation module
pub use attestation::StorageKey as TeeRegistryStorageKey;

// Common result type for TEE operations
pub type TeeResult<T> = Result<T, TeeAttestationError>;