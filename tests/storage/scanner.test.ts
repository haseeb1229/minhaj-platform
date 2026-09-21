import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createClamAvScanner, interpret } from '../../packages/storage/src/scanner.ts';

/**
 * Scanner result mapping and failure semantics.
 *
 * These are the UNIT proofs. They establish that every clamd reply maps to the
 * right category and that an outage is never a pass. The REAL ClamAV
 * integration — a genuine daemon, a genuine detection — is
 * `tests/storage/clamav.integration.test.ts`, because a fake scanner cannot
 * prove that detection works.
 */

describe('every clamd reply maps to a safe category', () => {
  it('reads a clean result', () => {
    expect(interpret('stream: OK\u0000')).toEqual({ status: 'clean' });
  });

  it('reads a detection and keeps the signature name', () => {
    expect(interpret('stream: Win.Test.EICAR_HDB-1 FOUND\u0000')).toEqual({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('reads a detection even when the signature cannot be parsed', () => {
    // Still infected. A signature we failed to name is not a reason to pass.
    expect(interpret('FOUND')).toEqual({ status: 'infected', signature: null });
  });

  it('treats a scanner error as unscannable, not clean', () => {
    expect(interpret('stream: INSTREAM size limit exceeded. ERROR\u0000')).toEqual({
      status: 'unscannable',
    });
  });

  it.each([
    ['an empty reply', ''],
    ['whitespace', '   \n'],
    ['a truncated reply', 'strea'],
    ['something unrecognised', 'PONG'],
    ['a reply in an unexpected shape', '{"status":"fine"}'],
  ])('treats %s as unavailable rather than clean', (_label, reply) => {
    expect(interpret(reply)).toEqual({ status: 'unavailable' });
  });

  it('never reports clean for anything that also says FOUND', () => {
    // Ordering matters: a reply containing both words must not be read as OK
    // because `OK` happened to be matched first.
    expect(interpret('stream: Some.Sig FOUND\u0000OK')).toMatchObject({
      status: 'infected',
    });
  });
});

describe('an unreachable scanner fails closed', () => {
  let directory: string;
  let sample: string;

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'minhaj-scanner-'));
    sample = path.join(directory, 'sample.bin');
    writeFileSync(sample, 'harmless synthetic bytes');
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports unavailable when nothing is listening', async () => {
    // Port 1 on loopback: reserved, and nothing the suite runs binds it.
    const scanner = createClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000 });

    expect(await scanner.scan(sample)).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when the scanner accepts and then says nothing', async () => {
    // The hang case. A scanner that is UP but not answering must time out into
    // a refusal — this is the outage shape most likely to be mistaken for
    // success by an implementation that waits forever.
    const server = await listen((socket) => void socket);

    try {
      const scanner = createClamAvScanner({
        host: '127.0.0.1',
        port: portOf(server),
        timeoutMs: 1200,
      });

      expect(await scanner.scan(sample)).toEqual({ status: 'unavailable' });
    } finally {
      server.close();
    }
  });

  it('reports unscannable when the file cannot be read', async () => {
    const server = await listen((socket) => socket.end('stream: OK\u0000'));

    try {
      const scanner = createClamAvScanner({
        host: '127.0.0.1',
        port: portOf(server),
        timeoutMs: 5000,
      });

      // A scanner that answers OK while the bytes were never sent must not
      // produce a clean verdict for a file that does not exist.
      const outcome = await scanner.scan(path.join(directory, 'absent.bin'));
      expect(outcome.status).not.toBe('clean');
    } finally {
      server.close();
    }
  });

  it('maps a genuine OK from a stand-in daemon to clean', async () => {
    // Proves the socket protocol itself works end to end. It does NOT stand in
    // for detection: that is the real-ClamAV integration's job.
    const server = await listen((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.includes(Buffer.from([0, 0, 0, 0]))) socket.end('stream: OK\u0000');
      });
    });

    try {
      const scanner = createClamAvScanner({
        host: '127.0.0.1',
        port: portOf(server),
        timeoutMs: 5000,
      });

      expect(await scanner.scan(sample)).toEqual({ status: 'clean' });
    } finally {
      server.close();
    }
  });
});

function listen(onConnection: (socket: Socket) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(onConnection);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port bound.');
  return address.port;
}
