import { fallback, http } from 'viem';

const PROXY_ORIGIN = process.env.NEXT_PUBLIC_PROXY_ORIGIN || 'https://staging-proxy.sky.money';

// The proxy rejects JSON-RPC batches longer than this. viem splits a larger burst into several batches
// sent in parallel, so the cap costs extra requests, not latency.
const PROXY_MAX_BATCH_SIZE = 20;

const proxyHttp = (url: string) => http(url, { batch: { wait: 500, batchSize: PROXY_MAX_BATCH_SIZE } });

export const createProxyTransport = (chainId: number) =>
  fallback([
    proxyHttp(`${PROXY_ORIGIN}/rpc/${chainId}`),
    proxyHttp(`${PROXY_ORIGIN}/rpc-fallback/${chainId}`)
  ]);
