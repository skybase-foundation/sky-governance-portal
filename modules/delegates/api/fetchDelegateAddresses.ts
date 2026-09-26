import { fetchAllDelegates } from './fetchAllDelegates';
import { allDelegateAddressesKey } from 'modules/cache/constants/cache-keys';
import { cacheGet, cacheSet } from 'modules/cache/cache';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { networkNameToChainId } from 'modules/web3/helpers/chain';
import { AllDelegatesEntry } from '../types';
import { ONE_HOUR_IN_MS } from 'modules/app/constants/time';

export async function fetchDelegateAddresses(network: SupportedNetworks): Promise<AllDelegatesEntry[]> {
  const cachedResponse = await cacheGet(allDelegateAddressesKey, network);
  if (cachedResponse) return JSON.parse(cachedResponse);

  const chainId = networkNameToChainId(network);

  const delegateRows = await fetchAllDelegates(chainId);

  const delegates = delegateRows.map(delegate => ({
    blockTimestamp: new Date(Number(delegate?.blockTimestamp || 0) * 1000),
    delegate: delegate?.ownerAddress,
    voteDelegate: delegate?.address
  })) as AllDelegatesEntry[];

  cacheSet(allDelegateAddressesKey, JSON.stringify(delegates), network, ONE_HOUR_IN_MS);

  return delegates;
}
