import fetch from 'node-fetch';

// Define types for NEAR RPC response
interface RPCResponse<T = any> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface EscrowStats {
  total_orders?: number;
  pending_orders?: number;
  locked_orders?: number;
  fulfilled_orders?: number;
}

interface Order {
  id: string;
  status: string;
  // Add other order properties as needed
}

async function checkNearOrders() {
  console.log('🔍 Checking NEAR escrow contract for relayer-created orders...');
  
  try {
    const rpcUrl = 'https://rpc.testnet.near.org';
    const contractId = 'escrow-v2.fusionswap.testnet'; // Verified contract ID
    const methodName = 'get_stats';
    
    console.log(`🔍 Querying contract: ${contractId}, method: ${methodName}`);
    console.log(`🌐 RPC URL: ${rpcUrl}`);
    
    // Make a direct JSON-RPC call to the NEAR testnet
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'query',
        params: {
          request_type: 'call_function',
account_id: 'escrow-v2.fusionswap.testnet',
          method_name: 'get_stats',
          args_base64: 'e30=', // '{}' in base64
          finality: 'final'
        }
      })
    });

    const result = await response.json();
    
    console.log('📡 RPC Response:', JSON.stringify(result, null, 2));
    
    if (result.error) {
      throw new Error(`RPC Error [${result.error.code}]: ${result.error.message}`);
    }
    
    if (!result) {
      throw new Error('No response received from RPC endpoint');
    }
    
    // Parse the result from base64 if available
    if (!result.result || !result.result.result) {
      throw new Error('Invalid RPC response format');
    }
    
    // Convert base64 response to string and parse as JSON
    const resultBuffer = Buffer.from(result.result.result, 'base64');
    const stats: EscrowStats = JSON.parse(resultBuffer.toString('utf-8'));
    
    console.log('📊 NEAR Escrow Contract Stats:');
    console.log('  Total Orders:', stats.total_orders || 0);
    console.log('  Pending Orders:', stats.pending_orders || 0);
    console.log('  Locked Orders:', stats.locked_orders || 0);
    console.log('  Fulfilled Orders:', stats.fulfilled_orders || 0);
    
        if (stats.total_orders && stats.total_orders > 0) {
      console.log('✅ Relayer has created orders on NEAR!');
      
      // Note: The get_recent_orders view call is commented out as it requires a proper account setup
      // which we're avoiding in this simplified version. In a production environment, you would
      // want to use the NEAR SDK with proper authentication to make this call.
      console.log('\nℹ️ To view recent orders, use the NEAR CLI or implement proper authentication');
    } else {
      console.log('❌ No orders found in the escrow contract');
    }
  } catch (error) {
    console.error('❌ Error checking NEAR escrow contract:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the function
checkNearOrders().catch(console.error);
