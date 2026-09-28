/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

export const DEPLOYMENT_BLOCK = {
  '0x929d9A1435662357F54AdcF64DcEE4d6b867a6f9': 22368736n //mainnet
};

// Chief V2's maxYays: an immutable set at deployment, with no setter and no proxy, so it can't change.
// A Chief V3 could use a different limit: check it before pointing the portal at a new Chief, since
// getSlateAddresses reads at most this many spells from a slate.
export const CHIEF_MAX_YAYS = 5;
