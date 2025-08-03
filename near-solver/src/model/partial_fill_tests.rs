#[cfg(test)]
mod partial_fill_tests {
    use super::super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn get_context() -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1));
        builder
    }

    fn create_test_order_for_partial_fills() -> CrossChainOrder {
        CrossChainOrder::new(
            "test-partial-order".to_string(),
            "ethereum".to_string(),
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".to_string(),
            5000000000000000000u128, // 5 ETH
            "0xSourceAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            5000000000000000000u128, // 5 wNEAR
            "alice.near".to_string(),
            "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
            1735689600, // timelock - Jan 1, 2025
        ).expect("Failed to create test order")
    }

    #[test]
    fn test_partial_fill_processing() {
        let context = get_context();
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        
        // Initial state
        assert_eq!(order.filled_amount, 0);
        assert_eq!(order.remaining_amount, 5000000000000000000u128);
        assert_eq!(order.status, OrderStatus::Created);
        assert_eq!(order.fill_count, 0);
        assert!(order.fill_history.is_empty());

        // Process first partial fill (1 ETH)
        let fill_result = order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            Some("0x1234".to_string())
        );
        
        assert!(fill_result.is_ok());
        let fill_event = fill_result.unwrap();
        
        // Verify fill event
        assert_eq!(fill_event.filled_amount, 1000000000000000000u128);
        assert_eq!(fill_event.executor, "solver.near");
        assert_eq!(fill_event.tx_hash, Some("0x1234".to_string()));
        
        // Verify order state after first fill
        assert_eq!(order.filled_amount, 1000000000000000000u128);
        assert_eq!(order.remaining_amount, 4000000000000000000u128);
        assert_eq!(order.status, OrderStatus::PartiallyFilled);
        assert_eq!(order.fill_count, 1);
        assert_eq!(order.fill_history.len(), 1);
        assert_eq!(order.get_fill_percentage(), 20); // 20%

        // Process second partial fill (2 ETH)
        let fill_result = order.process_partial_fill(
            2000000000000000000u128,
            "solver2.near".to_string(),
            Some("0x5678".to_string())
        );
        
        assert!(fill_result.is_ok());
        
        // Verify order state after second fill
        assert_eq!(order.filled_amount, 3000000000000000000u128);
        assert_eq!(order.remaining_amount, 2000000000000000000u128);
        assert_eq!(order.status, OrderStatus::PartiallyFilled);
        assert_eq!(order.fill_count, 2);
        assert_eq!(order.fill_history.len(), 2);
        assert_eq!(order.get_fill_percentage(), 60); // 60%

        // Process final fill (remaining 2 ETH)
        let fill_result = order.process_partial_fill(
            2000000000000000000u128,
            "solver3.near".to_string(),
            Some("0x9abc".to_string())
        );
        
        assert!(fill_result.is_ok());
        
        // Verify order is completely filled
        assert_eq!(order.filled_amount, 5000000000000000000u128);
        assert_eq!(order.remaining_amount, 0);
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(order.fill_count, 3);
        assert_eq!(order.fill_history.len(), 3);
        assert_eq!(order.get_fill_percentage(), 100); // 100%
        assert!(order.is_completely_filled());
        assert!(!order.is_partially_filled());
    }

    #[test]
    fn test_partial_fill_validation() {
        let context = get_context();
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        
        // Test fill amount validation
        let result = order.process_partial_fill(
            0, // Zero amount
            "solver.near".to_string(),
            None
        );
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ValidationError::InvalidAmount));

        // Test minimum fill amount
        let result = order.process_partial_fill(
            1000, // Below minimum (1% of 5 ETH)
            "solver.near".to_string(),
            None
        );
        assert!(result.is_err());

        // Test exceeding remaining amount
        let result = order.process_partial_fill(
            6000000000000000000u128, // More than total order
            "solver.near".to_string(),
            None
        );
        assert!(result.is_err());

        // Test partial fills disabled
        order.allow_partial_fills = false;
        let result = order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            None
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_order_splitting() {
        let context = get_context();
        testing_env!(context.build());

        let order = create_test_order_for_partial_fills();
        
        // Split into 3 parts: 2 ETH, 2 ETH, 1 ETH
        let split_amounts = vec![
            2000000000000000000u128,
            2000000000000000000u128,
            1000000000000000000u128,
        ];
        
        let result = order.split_order(split_amounts);
        assert!(result.is_ok());
        
        let child_orders = result.unwrap();
        assert_eq!(child_orders.len(), 3);
        
        // Verify child orders
        for (i, child_order) in child_orders.iter().enumerate() {
            assert_eq!(child_order.parent_order_id, Some("test-partial-order".to_string()));
            assert_eq!(child_order.status, OrderStatus::Created);
            assert_eq!(child_order.filled_amount, 0);
            assert!(child_order.id.contains("split"));
            
            // Verify amounts
            match i {
                0 | 1 => {
                    assert_eq!(child_order.source_amount, 2000000000000000000u128);
                    assert_eq!(child_order.remaining_amount, 2000000000000000000u128);
                }
                2 => {
                    assert_eq!(child_order.source_amount, 1000000000000000000u128);
                    assert_eq!(child_order.remaining_amount, 1000000000000000000u128);
                }
                _ => panic!("Unexpected child order"),
            }
        }
    }

    #[test]
    fn test_order_splitting_validation() {
        let context = get_context();
        testing_env!(context.build());

        let order = create_test_order_for_partial_fills();
        
        // Test invalid total amount
        let split_amounts = vec![
            2000000000000000000u128,
            2000000000000000000u128,
            2000000000000000000u128, // Total = 6 ETH, but order is 5 ETH
        ];
        
        let result = order.split_order(split_amounts);
        assert!(result.is_err());

        // Test amounts below minimum
        let split_amounts = vec![
            4999000000000000000u128, // Almost all
            1000000000000000u128,    // Below minimum
        ];
        
        let result = order.split_order(split_amounts);
        assert!(result.is_err());

        // Test splitting disabled
        let mut order_no_partial = order.clone();
        order_no_partial.allow_partial_fills = false;
        
        let split_amounts = vec![
            3000000000000000000u128,
            2000000000000000000u128,
        ];
        
        let result = order_no_partial.split_order(split_amounts);
        assert!(result.is_err());
    }

    #[test]
    fn test_refund_logic() {
        let mut context = get_context();
        context.block_timestamp(2000000000000000000); // Set future timestamp
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        
        // Partially fill the order
        order.process_partial_fill(
            2000000000000000000u128, // Fill 2 ETH out of 5
            "solver.near".to_string(),
            Some("0x1234".to_string())
        ).unwrap();
        
        // Order should need refund (expired with remaining amount)
        assert!(order.needs_refund());
        assert_eq!(order.calculate_refund_amount(), 3000000000000000000u128); // 3 ETH remaining
        
        // Test fully filled order doesn't need refund
        order.process_partial_fill(
            3000000000000000000u128, // Fill remaining 3 ETH
            "solver.near".to_string(),
            Some("0x5678".to_string())
        ).unwrap();
        
        assert!(!order.needs_refund());
        assert_eq!(order.calculate_refund_amount(), 0);
    }

    #[test]
    fn test_fill_percentage_calculation() {
        let context = get_context();
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        
        // Initial: 0%
        assert_eq!(order.get_fill_percentage(), 0);
        
        // Fill 1 ETH out of 5: 20%
        order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            None
        ).unwrap();
        assert_eq!(order.get_fill_percentage(), 20);
        
        // Fill another 2 ETH: 60%
        order.process_partial_fill(
            2000000000000000000u128,
            "solver.near".to_string(),
            None
        ).unwrap();
        assert_eq!(order.get_fill_percentage(), 60);
        
        // Fill remaining 2 ETH: 100%
        order.process_partial_fill(
            2000000000000000000u128,
            "solver.near".to_string(),
            None
        ).unwrap();
        assert_eq!(order.get_fill_percentage(), 100);
    }

    #[test]
    fn test_max_fills_limit() {
        let context = get_context();
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        order.max_fills = 2; // Limit to 2 fills
        
        // First fill should succeed
        let result = order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            None
        );
        assert!(result.is_ok());
        
        // Second fill should succeed
        let result = order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            None
        );
        assert!(result.is_ok());
        
        // Third fill should fail (exceeds max_fills)
        let result = order.process_partial_fill(
            1000000000000000000u128,
            "solver.near".to_string(),
            None
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_fill_history_tracking() {
        let context = get_context();
        testing_env!(context.build());

        let mut order = create_test_order_for_partial_fills();
        
        // Process multiple fills
        let fills = vec![
            (1000000000000000000u128, "solver1.near", "0x1111"),
            (1500000000000000000u128, "solver2.near", "0x2222"),
            (2500000000000000000u128, "solver3.near", "0x3333"),
        ];
        
        for (amount, executor, tx_hash) in fills {
            order.process_partial_fill(
                amount,
                executor.to_string(),
                Some(tx_hash.to_string())
            ).unwrap();
        }
        
        // Verify fill history
        assert_eq!(order.fill_history.len(), 3);
        
        for (i, fill_event) in order.fill_history.iter().enumerate() {
            assert!(fill_event.fill_id.contains(&format!("fill-{}", i + 1)));
            assert_eq!(fill_event.executor, format!("solver{}.near", i + 1));
            assert_eq!(fill_event.tx_hash, Some(format!("0x{}{}{}{}", i + 1, i + 1, i + 1, i + 1)));
        }
    }
}
