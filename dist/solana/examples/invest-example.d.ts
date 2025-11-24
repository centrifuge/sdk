/**
 * Example: Investing in a Centrifuge Pool via Solana
 *
 * This example demonstrates how to invest USDC into a Centrifuge pool
 * using a Solana wallet. This is intended for use in a web application
 * with the @solana/wallet-adapter-react package.
 */
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
 *       const pool = sdk.pool(poolId)
 *       const shareClass = pool.shareClass(shareClassId)
 *       const solanaInvest = shareClass.solana()
 *
 *       // Check if this pool supports Solana investments
 *       if (!solanaInvest.isAvailable()) {
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
 *       solanaInvest.invest(usdcAmount, wallet).subscribe({
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
 *       // const result = await solanaInvest.invest(usdcAmount, wallet)
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
declare function exampleDirectInvestment(): Promise<void>;
/**
 * Example: Check multiple pools for Solana support
 */
declare function checkPoolsSolanaSupport(): Promise<void>;
export { exampleDirectInvestment, checkPoolsSolanaSupport };
//# sourceMappingURL=invest-example.d.ts.map