/*

SPDX-FileCopyrightText: © 2026 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

export const indexerProgress = (chainId: number) => /* GraphQL */ `
query indexerProgress {
  _meta(where: { chainId: { _eq: ${chainId} } }) {
    progressBlock
    isReady
  }
}
`;
