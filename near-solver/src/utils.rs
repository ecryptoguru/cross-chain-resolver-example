//! Utility functions for the cross-chain solver
//!
//! This module contains helper functions used throughout the solver.

use near_sdk::env;

/// Get the current block timestamp in seconds
pub fn env_block_timestamp_seconds() -> u64 {
    env::block_timestamp() / 1_000_000_000 // Convert nanoseconds to seconds
}

/// Validate that a string is not empty
pub fn validate_non_empty_string(value: &str, field_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{} cannot be empty", field_name))
    } else {
        Ok(())
    }
}

/// Validate that an amount is greater than zero
pub fn validate_positive_amount(amount: u128, field_name: &str) -> Result<(), String> {
    if amount == 0 {
        Err(format!("{} must be greater than zero", field_name))
    } else {
        Ok(())
    }
}
