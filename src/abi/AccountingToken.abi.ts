// ERC-6909 accounting token used by OnchainPM workflows. Mint rights are keyed by pool, so an
// OnchainPM is only fully authorized when it is a minter for its own pool id (see
// OnchainPM.isAuthorized).
export default ['function minters(uint64 poolId, address account) view returns (bool)'] as const
