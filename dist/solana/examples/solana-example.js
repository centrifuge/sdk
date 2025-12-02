/**
 * Example: Using Solana Integration with Centrifuge SDK
 *
 * This example demonstrates how to use both EVM and Solana
 * functionality within a single Centrifuge SDK instance.
 */
import { Centrifuge } from '../../index.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
async function main() {
    console.log('Centrifuge SDK - Solana Integration Example\n');
    // Initialize SDK with both EVM and Solana support
    const sdk = new Centrifuge({
        environment: 'testnet',
        // Optional: EVM chains configuration
        rpcUrls: {
            11155111: ['https://eth-sepolia.g.alchemy.com/v2/demo'], // Sepolia
            84532: [`https://base-sepolia.g.alchemy.com/v2/demo`],
            421612: [`https://arb-sepolia.g.alchemy.com/v2/demo`],
            431142: [`https://avax-sepolia.g.alchemy.com/v2/demo`],
            11142220: [`https://celo-sepolia.g.alchemy.com/v2/demo`],
        },
        // Solana configuration
        solana: {
            rpcUrl: 'https://api.devnet.solana.com',
            commitment: 'confirmed',
        },
    });
    console.log('SDK initialized with Solana support\n');
    // Check if Solana is available
    if (!sdk.solana) {
        console.error('ERROR: Solana not configured');
        return;
    }
    console.log('Querying Solana blockchain...\n');
    // 1. Get current slot
    console.log('1. Getting current slot...');
    const slot = await sdk.solana.getSlot();
    console.log(`   Current Solana slot: ${slot}\n`);
    // 2. Query SOL balance for a known address (System Program)
    console.log('2. Querying SOL account balance...');
    const systemProgramAddress = '11111111111111111111111111111111';
    const solBalance = await sdk.solana.balance(systemProgramAddress);
    console.log(`   System Program balance: ${solBalance / LAMPORTS_PER_SOL} SOL\n`);
    // 3. Get account info
    console.log('3. Getting account info...');
    const accountInfo = await sdk.solana.accountInfo(systemProgramAddress);
    if (accountInfo) {
        console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
        console.log(`   Executable: ${accountInfo.executable}`);
        console.log(`   Data length: ${accountInfo.data.length} bytes\n`);
    }
    // 4. Query USDC balance (will be 0 for System Program, but demonstrates the API)
    console.log('4. Getting USDC balance...');
    try {
        const usdcBalance = await sdk.solana.usdcBalance(systemProgramAddress);
        console.log(`   USDC balance: ${usdcBalance.toFloat()} USDC\n`);
    }
    catch (error) {
        console.log(`   No USDC account (expected for System Program)\n`);
    }
    // 5. Access the underlying Solana connection for advanced operations
    console.log('5. Using direct connection access...');
    const connection = sdk.solana.connection;
    const version = await connection.getVersion();
    console.log(`   Solana version: ${JSON.stringify(version)}\n`);
    // 6. Demonstrate observable pattern
    console.log('6. Testing observable pattern...');
    const balance$ = sdk.solana.balance(systemProgramAddress);
    // Can subscribe for updates
    const subscription = balance$.subscribe({
        next: (bal) => console.log(`   Balance update: ${bal / LAMPORTS_PER_SOL} SOL`),
        error: (err) => console.error(`   Error: ${err}`),
    });
    // Clean up subscription
    setTimeout(() => subscription.unsubscribe(), 100);
    console.log('\nExample completed successfully!');
    console.log('\nNext steps:');
    console.log('   - See invest-example.ts for USDC investment examples');
    console.log('   - Query EVM pools alongside Solana operations');
    console.log('   - Build cross-chain applications\n');
}
// Run the example
main().catch((error) => {
    console.error('ERROR: Error running example:', error);
    process.exit(1);
});
//# sourceMappingURL=solana-example.js.map