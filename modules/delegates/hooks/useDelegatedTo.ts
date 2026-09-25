/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { fetchJson } from 'lib/fetchJson';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { SKYDelegatedToAPIResponse } from 'pages/api/address/[address]/delegated-to';
import useSWR from 'swr';

export function useDelegatedTo(
  address: string | undefined,
  network: SupportedNetworks
): {
  data: SKYDelegatedToAPIResponse | undefined;
  error: Error | undefined;
} {
  const { data, error } = useSWR<SKYDelegatedToAPIResponse>(
    !!address && !!network ? `/api/address/${address}/delegated-to?network=${network}` : null,
    fetchJson,
    {
      revalidateOnFocus: false,
      refreshInterval: 0,
      revalidateOnMount: true
    }
  );

  return {
    data,
    error
  };
}
