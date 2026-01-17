/**
 * Example: Investing in a Centrifuge Pool via Solana
 *
 * This example demonstrates how to invest USDC into a Centrifuge pool
 * using a Solana wallet. This is intended for use in a web application
 * with the @solana/wallet-adapter-react package.
 */
import { Centrifuge, Balance, ShareClassId } from '../../index.js';
/**
 * Example for a React component using @solana/wallet-adapter-react
 *
 * In your React app:
 * ```tsx
 * import { useWallet } from '@solana/wallet-adapter-react'
 * import { Centrifuge, Balance, ShareClassId } from '@centrifuge/sdk'
 *
 * function InvestComponent() {
 *   const { publicKey, signTransaction } = useWallet()
 *   const [sdk] = useState(() => new Centrifuge({
 *     environment: 'mainnet',
 *     solana: {
 *       rpcUrl: 'https://api.mainnet-beta.solana.com',
 *       commitment: 'confirmed',
 *     }
 *   }))
 *
 *   const handleInvest = async (poolId: string, shareClassId: string, amount: number) => {
 *     if (!publicKey || !signTransaction) {
 *       alert('Please connect your Solana wallet')
 *       return
 *     }
 *
 *     try {
 *       // Check if this pool supports Solana investments
 *       const shareClassId = new ShareClassId(shareClassId)
 *       if (!sdk.solana!.isSolanaPool(shareClassId)) {
 *         alert('This pool does not support Solana investments yet')
 *         return
 *       }
 *
 *       // Convert amount to Balance (USDC has 6 decimals)
 *       const usdcAmount = Balance.fromFloat(amount, 6)
 *
 *       // Create wallet adapter object
 *       const wallet = { publicKey, signTransaction }
 *
 *       // Subscribe to transaction status updates
 *       sdk.solana!.invest(usdcAmount, shareClassId, wallet).subscribe({
 *         next: (status) => {
 *           switch (status.type) {
 *             case 'preparing':
 *               console.log('Preparing transaction...')
 *               break
 *             case 'signing':
 *               console.log('Please sign the transaction in your wallet')
 *               break
 *             case 'sending':
 *               console.log('Sending transaction to Solana...')
 *               break
 *             case 'confirming':
 *               console.log('Waiting for confirmation...', status.signature)
 *               break
 *             case 'confirmed':
 *               console.log('Investment confirmed!', status.signature)
 *               alert(`Successfully invested ${amount} USDC!`)
 *               break
 *           }
 *         },
 *         error: (error) => {
 *           console.error('Investment failed:', error)
 *           alert(`Investment failed: ${error.message}`)
 *         },
 *       })
 *
 *       // Or use async/await
 *       // const result = await sdk.solana!.invest(usdcAmount, shareClassId, wallet)
 *       // console.log('Transaction confirmed:', result.signature)
 *
 *     } catch (error) {
 *       console.error('Error:', error)
 *     }
 *   }
 *
 *   return (
 *     <button onClick={() => handleInvest('123', '0x...', 1000)}>
 *       Invest 1000 USDC
 *     </button>
 *   )
 * }
 * ```
 */
/**
 * Example using the SDK directly (for testing or scripts)
 */
async function exampleDirectInvestment() {
    console.log('Centrifuge SDK - Solana Investment Example\n');
    // Initialize SDK with Solana support
    const sdk = new Centrifuge({
        environment: 'testnet',
        solana: {
            rpcUrl: 'https://api.devnet.solana.com',
            commitment: 'confirmed',
        },
    });
    console.log('SDK initialized with Solana support\n');
    // Mock wallet adapter (in a real app, this comes from @solana/wallet-adapter-react)
    const mockWallet = {
        publicKey: null, // Would be set when wallet is connected
        signTransaction: async (tx) => tx, // Would show wallet popup in real scenario
    };
    // Example share class ID (must be 34 chars: 0x + 32 hex chars)
    const shareClassId = new ShareClassId('0x1234567890abcdef1234567890abcdef');
    console.log('Checking if pool supports Solana investments...');
    const isAvailable = sdk.solana.isSolanaPool(shareClassId);
    console.log(`   Pool Solana support: ${isAvailable ? 'Available' : 'Not available'}\n`);
    if (!isAvailable) {
        console.log('WARNING: This pool does not have a Solana address configured yet.');
        console.log('   Check the poolAddresses.ts configuration file.\n');
        return;
    }
    // Prepare investment amount (1000 USDC)
    const amount = Balance.fromFloat(1000, 6);
    console.log(`Preparing to invest: ${amount.toFloat()} USDC\n`);
    // Note: This would fail without a real connected wallet
    console.log('Investment flow:');
    console.log('   1. Validate wallet connection');
    console.log('   2. Check USDC balance');
    console.log('   3. Create transfer instruction');
    console.log('   4. Request wallet signature');
    console.log('   5. Send transaction to Solana');
    console.log('   6. Wait for confirmation\n');
    try {
        // Subscribe to status updates
        const investment$ = sdk.solana.invest(amount, shareClassId, mockWallet);
        investment$.subscribe({
            next: (status) => {
                console.log(`[${status.type.toUpperCase()}] ${status.message}`);
                if (status.type === 'confirmed' && 'signature' in status) {
                    console.log(`   Transaction: ${status.signature}`);
                }
            },
            error: (error) => {
                console.error('ERROR: Investment failed:', error.message);
                if (error.code) {
                    console.error(`   Error code: ${error.code}`);
                }
            },
            complete: () => {
                console.log('\nInvestment completed successfully!');
            },
        });
        // Or use async/await
        // const result = await investment$
        // console.log('Confirmed:', result.signature)
    }
    catch (error) {
        console.error('ERROR:', error);
    }
}
/**
 * Example: Check multiple pools for Solana support
 */
async function checkPoolsSolanaSupport() {
    const sdk = new Centrifuge({
        environment: 'mainnet',
        solana: {
            rpcUrl: 'https://api.mainnet-beta.solana.com',
            commitment: 'confirmed',
        },
    });
    // List of pools to check
    const poolsToCheck = [
        { poolId: '1', shareClassId: '0x...' },
        { poolId: '2', shareClassId: '0x...' },
        { poolId: '3', shareClassId: '0x...' },
    ];
    console.log('Checking Solana support for multiple pools:\n');
    for (const { poolId, shareClassId } of poolsToCheck) {
        const id = new ShareClassId(shareClassId);
        const isAvailable = sdk.solana.isSolanaPool(id);
        console.log(`Pool ${poolId}: Solana ${isAvailable ? 'available' : 'not available'}`);
    }
}
// Uncomment to run examples:
// exampleDirectInvestment().catch(console.error)
// checkPoolsSolanaSupport().catch(console.error)
export { exampleDirectInvestment, checkPoolsSolanaSupport };
//# sourceMappingURL=invest-example.js.map