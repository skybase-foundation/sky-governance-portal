/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import { parseRawUrl } from '../parseRawUrl';

describe('parseRawUrl', () => {
  it('maps raw GitHub content to the blob page with the review anchor', () => {
    expect(
      parseRawUrl('https://raw.githubusercontent.com/sky-ecosystem/polls/refs/heads/main/polls/1.md')
    ).toBe('https://github.com/sky-ecosystem/polls/blob/refs/heads/main/polls/1.md#review');
  });

  it('rejects other schemes, hosts and shapes', () => {
    expect(parseRawUrl('http://raw.githubusercontent.com/org/repo/main/a.md')).toBe('');
    expect(parseRawUrl('https://evil.example/org/repo/main/a.md')).toBe('');
    expect(parseRawUrl('https://raw.githubusercontent.com.evil.example/org/repo/main/a.md')).toBe('');
    expect(parseRawUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(parseRawUrl('javascript:alert(1)')).toBe('');
    expect(parseRawUrl('https://raw.githubusercontent.com/org/repo')).toBe('');
    expect(parseRawUrl('not a url')).toBe('');
    expect(parseRawUrl('')).toBe('');
  });
});
