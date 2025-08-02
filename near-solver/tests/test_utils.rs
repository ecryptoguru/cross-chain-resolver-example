//! Test utilities for integration tests

use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, VMContext, AccountId};
use near_sdk::NearToken;

/// Create a test context with the given parameters
pub fn get_context(
    predecessor_account_id: AccountId,
    deposit: u128,
    is_view: bool,
) -> VMContext {
    // For testing purposes, we'll create a NearToken directly from yoctoNEAR
    let deposit_token = NearToken::from_yoctonear(deposit);
    
    let context = VMContextBuilder::new()
        .current_account_id(account("contract.near"))
        .signer_account_id(predecessor_account_id.clone())
        .predecessor_account_id(predecessor_account_id)
        .attached_deposit(deposit_token)
        .is_view(is_view)
        .build();
    
    testing_env!(context.clone());
    context
}

/// Setup the testing environment with the given context
pub fn setup_test() {
    // Any additional test setup can go here
}

/// Helper function to create an account ID from a string
pub fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

/// Helper function to create a balance from a number of NEAR
pub fn near(amount: u128) -> u128 {
    amount * 10u128.pow(24)
}

/// Helper function to create a balance from a number of yoctoNEAR
pub fn yocto(amount: u128) -> u128 {
    amount
}

/// Helper function to create a balance from a number of millinear
pub fn millinear(amount: u128) -> u128 {
    amount * 10u128.pow(21)
}
