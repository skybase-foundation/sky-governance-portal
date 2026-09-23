/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { gqlRequest } from 'modules/gql/gqlRequest';
import { SupportedNetworks } from 'modules/web3/constants/networks';
import { fetchDelegationEventsByUser } from '../fetchDelegationEventsByUser';
import { fetchDelegationEventsByAddresses } from '../fetchDelegationEventsByAddresses';
import { fetchDelegatedTo } from '../fetchDelegatedTo';

vi.mock('modules/gql/gqlRequest');

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const DELEGATE = '0x00000000000000000000000000000000000000bb';

describe('delegation fetchers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gqlRequest as Mock).mockRejectedValue(new Error('indexer unavailable'));
  });

  it('fetchDelegationEventsByUser rejects instead of returning no events', async () => {
    await expect(fetchDelegationEventsByUser(DELEGATE, ADDRESS, SupportedNetworks.MAINNET)).rejects.toThrow(
      'indexer unavailable'
    );
  });

  it('fetchDelegationEventsByAddresses rejects instead of returning no events', async () => {
    await expect(fetchDelegationEventsByAddresses([DELEGATE], SupportedNetworks.MAINNET)).rejects.toThrow(
      'indexer unavailable'
    );
  });

  it('fetchDelegatedTo rejects instead of returning no delegations', async () => {
    await expect(fetchDelegatedTo(ADDRESS, SupportedNetworks.MAINNET)).rejects.toThrow('indexer unavailable');
  });
});
