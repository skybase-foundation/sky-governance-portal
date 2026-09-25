/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSlateAddresses } from '../getSlateAddresses';
import { mainnetPublicClient } from 'modules/wagmi/config/config.default';
import { CHIEF_MAX_YAYS } from 'modules/contracts/contracts.constants';

vi.mock('modules/wagmi/config/config.default', () => ({
  mainnetPublicClient: { multicall: vi.fn() },
  tenderlyPublicClient: { multicall: vi.fn() },
  tenderly: { id: 314310 }
}));

const CHIEF = '0x929d9A1435662357F54AdcF64DcEE4d6b867a6f9';
const SLATE = '0x7a7df2645617a7ced6deed4b73fc7c302fb40daab4d8a1849dfd93859ddff783';
const SPELL_A = '0x86d6CdD0D259AAAfb8134D47464b77743F50380B';
const SPELL_B = '0xF01b594aF26fC8A8ae1e24DCaF904ECB6Fd1BaDC';

const outOfBounds = { status: 'failure', error: new Error('reverted') };
const multicall = vi.mocked(mainnetPublicClient.multicall);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSlateAddresses', () => {
  it('reads the length and every index the slate can hold in one multicall', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: 2n },
      { status: 'success', result: SPELL_A },
      { status: 'success', result: SPELL_B },
      outOfBounds,
      outOfBounds,
      outOfBounds
    ] as never);

    await expect(getSlateAddresses(1, CHIEF, SLATE)).resolves.toEqual([SPELL_A, SPELL_B]);

    expect(multicall).toHaveBeenCalledTimes(1);
    const { contracts } = multicall.mock.calls[0][0] as { contracts: { functionName: string }[] };
    expect(contracts.map(c => c.functionName)).toEqual(['length', ...Array(CHIEF_MAX_YAYS).fill('slates')]);
  });

  it('throws instead of returning a partial slate when a read inside the slate fails', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: 2n },
      { status: 'success', result: SPELL_A },
      { status: 'failure', error: new Error('rpc error') },
      outOfBounds,
      outOfBounds,
      outOfBounds
    ] as never);

    await expect(getSlateAddresses(1, CHIEF, SLATE)).rejects.toThrow('rpc error');
  });

  it('throws instead of truncating a slate longer than CHIEF_MAX_YAYS', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: BigInt(CHIEF_MAX_YAYS + 1) },
      ...Array(CHIEF_MAX_YAYS).fill({ status: 'success', result: SPELL_A })
    ] as never);

    await expect(getSlateAddresses(1, CHIEF, SLATE)).rejects.toThrow(/more than CHIEF_MAX_YAYS/);
  });

  it('throws when the length read fails', async () => {
    multicall.mockResolvedValue([
      { status: 'failure', error: new Error('length failed') },
      ...Array(CHIEF_MAX_YAYS).fill(outOfBounds)
    ] as never);

    await expect(getSlateAddresses(1, CHIEF, SLATE)).rejects.toThrow('length failed');
  });

  it('throws when the RPC call fails', async () => {
    multicall.mockRejectedValue(new Error('timeout'));

    await expect(getSlateAddresses(1, CHIEF, SLATE)).rejects.toThrow('timeout');
  });
});
