import { createPublicClient, createWalletClient, custom, defineChain, http } from 'viem'

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
      webSocket: ['wss://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
  },
})

export const CONTRACT = '0xee9E5859674DB82c67d21710f1eFF8301eFdc1bD'

export const CHAIN_ID_HEX = '0x279f'

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
  batch: { multicall: true },
})

export function hasWallet() {
  return typeof window !== 'undefined' && !!window.ethereum
}

export async function connect() {
  if (!hasWallet()) throw new Error('No wallet found. Open this page inside MetaMask.')

  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })

  const current = await window.ethereum.request({ method: 'eth_chainId' })
  if (current.toLowerCase() !== CHAIN_ID_HEX) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CHAIN_ID_HEX }],
      })
    } catch {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: 'Monad Testnet',
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            rpcUrls: ['https://testnet-rpc.monad.xyz'],
            blockExplorerUrls: ['https://testnet.monadvision.com'],
          },
        ],
      })
    }
  }

  const walletClient = createWalletClient({
    account: address,
    chain: monadTestnet,
    transport: custom(window.ethereum),
  })

  return { address, walletClient }
}

export const explorerTx = (hash) => `${monadTestnet.blockExplorers.default.url}/tx/${hash}`
export const explorerAddress = (a) => `${monadTestnet.blockExplorers.default.url}/address/${a}`

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

export function rowOf(rank) {
  if (rank <= 5) return 1
  if (rank <= 15) return 2
  return 3
}
