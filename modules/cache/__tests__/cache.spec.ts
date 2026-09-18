/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

import fs from 'fs';
import { config } from '../../../lib/config';
import os from 'os';

import packageJSON from '../../../package.json';
import { cacheSet, cacheSetNX } from '../cache';
import { vi } from 'vitest';

vi.mock('lib/config');

const cacheFile = `/${os.tmpdir()}/sky-gov-portal-version-${packageJSON.version}-mainnet-test-${new Date()
  .toISOString()
  .substring(0, 10)}`;
const cacheSetNXFile = `/${os.tmpdir()}/sky-gov-portal-version-${
  packageJSON.version
}-mainnet-test-nx-${new Date().toISOString().substring(0, 10)}`;
const cacheSetNXDupFile = `/${os.tmpdir()}/sky-gov-portal-version-${
  packageJSON.version
}-mainnet-test-nx-dup-${new Date().toISOString().substring(0, 10)}`;

describe('Cache', () => {
  beforeAll(() => {
    config.USE_CACHE = 'true';
    config.REDIS_URL = '';
  });

  afterEach(() => {
    // Clean up test cache files after each test to ensure isolation
    if (fs.existsSync(cacheSetNXFile)) fs.unlinkSync(cacheSetNXFile);
    if (fs.existsSync(cacheSetNXDupFile)) fs.unlinkSync(cacheSetNXDupFile);
  });

  afterAll(() => {
    config.USE_CACHE = '';
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  });

  test('cacheSet creates a file', async () => {
    await cacheSet('test', 'test');
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  test('cacheSetNX creates a file and returns true when key is new', async () => {
    const result = await cacheSetNX('test-nx', `${Date.now()}`, undefined, 60_000);
    expect(result).toBe(true);
    expect(fs.existsSync(cacheSetNXFile)).toBe(true);
  });

  test('cacheSetNX returns false when key already exists and is not expired', async () => {
    await cacheSetNX('test-nx-dup', `${Date.now()}`, undefined, 60_000);
    const secondAttempt = await cacheSetNX('test-nx-dup', `${Date.now()}`, undefined, 60_000);
    expect(secondAttempt).toBe(false);
    expect(fs.existsSync(cacheSetNXDupFile)).toBe(true);
  });
});
