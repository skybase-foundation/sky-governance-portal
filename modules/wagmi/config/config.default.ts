import { createConfig, createStorage, http, noopStorage } from 'wagmi';
import { arbitrum, arbitrumSepolia, mainnet } from 'wagmi/chains';
import { SupportedChainId } from 'modules/web3/constants/chainID';
import { coinbaseWallet, metaMask, safe, walletConnect } from 'wagmi/connectors';
import { createPublicClient } from 'viem';
import { createProxyTransport } from './proxyTransport';

export const RPC_TENDERLY =
  'https://virtual.rpc.tenderly.co/jetstreamgg/jetstream/public/jetstream-testnet';
const RPC_ARBITRUM_TESTNET = process.env.NEXT_PUBLIC_RPC_ARBITRUM_TESTNET || '';

export const tenderly = {
  id: SupportedChainId.TENDERLY as const,
  name: 'Tenderly',
  network: 'tenderly',
  iconUrl: 'tokens/weth.svg',
  nativeCurrency: {
    decimals: 18,
    name: 'Ethereum',
    symbol: 'ETH'
  },
  rpcUrls: {
    public: { http: [RPC_TENDERLY] },
    default: { http: [RPC_TENDERLY] }
  },
  blockExplorers: {
    default: { name: '', url: '' }
  },
  contracts: mainnet.contracts
};

const httpBatchTransport = (url: string) =>
  http(url, {
    batch: { wait: 500 }
  });

const transports = {
  [mainnet.id]: createProxyTransport(mainnet.id),
  [tenderly.id]: httpBatchTransport(RPC_TENDERLY),
  [arbitrum.id]: createProxyTransport(arbitrum.id),
  [arbitrumSepolia.id]: httpBatchTransport(RPC_ARBITRUM_TESTNET)
};

const connectors = [
  metaMask(),
  walletConnect({
    name: 'Sky Governance Portal',
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'd5c6af7c0680adbaad12f33744ee4413'
  }),
  coinbaseWallet(),
  safe()
];

export const wagmiConfigDev = createConfig({
  chains: [mainnet, tenderly, arbitrum, arbitrumSepolia],
  ssr: true,
  connectors,
  transports: {
    [mainnet.id]: transports[mainnet.id],
    [tenderly.id]: transports[tenderly.id],
    [arbitrum.id]: transports[arbitrum.id],
    [arbitrumSepolia.id]: transports[arbitrumSepolia.id]
  },
  multiInjectedProviderDiscovery: true,
  storage: createStorage({
    storage: typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage,
    key: 'wagmi-dev'
  })
});

export const wagmiConfigProd = createConfig({
  chains: [mainnet, arbitrum],
  ssr: true,
  connectors,
  transports: {
    [mainnet.id]: transports[mainnet.id],
    [arbitrum.id]: transports[arbitrum.id]
  },
  multiInjectedProviderDiscovery: true
});

// Fold concurrent readContract calls into Multicall3 aggregate3 calls, as wagmi already does for the hooks.
// Without it every read is its own entry in a JSON-RPC batch, and a page that fans out over proposals or
// voters sends several proxy requests where a couple of eth_calls would do.
const publicClientBatch = { multicall: true } as const;

export const mainnetPublicClient = createPublicClient({
  chain: mainnet,
  transport: transports[mainnet.id],
  batch: publicClientBatch,
  key: 'mainnet-public-client',
  name: 'Mainnet public client'
});

export const tenderlyPublicClient = createPublicClient({
  chain: tenderly,
  transport: transports[tenderly.id],
  batch: publicClientBatch,
  key: 'tenderly-public-client',
  name: 'Tenderly public client'
});

export const arbitrumPublicClient = createPublicClient({
  chain: arbitrum,
  transport: transports[arbitrum.id],
  batch: publicClientBatch,
  key: 'arbitrum-public-client',
  name: 'Arbitrum public client'
});

export const arbitrumTestnetPublicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: transports[arbitrumSepolia.id],
  batch: publicClientBatch,
  key: 'arbitrum-testnet-public-client',
  name: 'Arbitrum Testnet public client'
});
