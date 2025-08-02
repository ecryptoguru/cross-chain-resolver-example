//! TEE (Trusted Execution Environment) attestation module
//!
//! This module provides comprehensive functionality for managing TEE attestations,
//! including type definitions, error handling, attestation data structures,
//! registry implementation, and storage management.
//!
//! ## Module Structure
//! - `types`: TEE type definitions and utilities
//! - `errors`: Comprehensive error handling for TEE operations
//! - `attestation_data`: Core attestation data structure and validation
//! - `registry_impl`: Main registry implementation for managing attestations
//! - `storage`: Storage key definitions for efficient data organization
//! - `signature_verification`: Signature verification module for TEE attestations
//! - `attestation`: Legacy attestation module (deprecated, use sub-modules)
//! - `registry`: Legacy registry module (deprecated, use registry_impl)

// Core modules
pub mod types;
pub mod errors;
pub mod attestation_data;
pub mod registry_impl;
pub mod storage;
pub mod signature_verification_wasm;

// Test module
#[cfg(test)]
pub mod tests;

// Legacy modules (for backward compatibility)
pub mod attestation;
pub mod registry;

// Re-export commonly used types for convenience
pub use types::TeeType;
pub use errors::TeeAttestationError;
pub use attestation_data::TeeAttestation;
pub use registry_impl::TeeAttestationRegistry;
pub use storage::StorageKey;

// Legacy re-exports for backward compatibility (specific imports to avoid ambiguity)
pub use attestation::TeeAttestation as LegacyTeeAttestation;
pub use registry::TeeRegistry;

// Common result type for TEE operations
pub type TeeResult<T> = Result<T, TeeAttestationError>;