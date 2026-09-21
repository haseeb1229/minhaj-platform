import 'server-only';

import { createReadStream } from 'node:fs';
import { connect, type Socket } from 'node:net';

import type { MalwareScannerPort, ScanOutcome } from '@minhaj/contracts/platform';

/**
 * The ClamAV (`clamd`) scanner adapter (SECURITY_BASELINE.md §10.1 rule 4).
 *
 * WHY CLAMAV. It is maintained by Cisco Talos, self-hostable, runs on Linux
 * under Docker Compose with no paid cloud service and no Azure dependency,
 * scans a stream, and is Apache-2.0 licensed. It is what SECURITY_BASELINE.md
 * §10.1 defers to "the phase that implements the storage foundation", and
 * nothing about the deployment direction argues for a hosted alternative.
 *
 * WHY `INSTREAM` RATHER THAN `SCAN <path>`. `SCAN` requires clamd to see the
 * same filesystem as the application, which means sharing the storage volume
 * into the scanner container. `INSTREAM` sends the bytes over the socket
 * instead, so the scanner needs NO access to the storage root at all. One
 * fewer mount, and a scanner compromise does not reach the corpus.
 *
 * FAIL CLOSED. Every failure path below returns `unavailable` or
 * `unscannable`. Neither is clean, and the caller keeps the file quarantined.
 * There is no branch in this file that turns an error into a pass.
 */

export interface ClamAvOptions {
  readonly host: string;
  readonly port: number;
  /** Milliseconds before an unresponsive scanner is treated as unavailable. */
  readonly timeoutMs: number;
}

/** clamd's INSTREAM framing: a zero-length chunk ends the stream. */
const TERMINATOR = Buffer.from([0, 0, 0, 0]);

export function createClamAvScanner(options: ClamAvOptions): MalwareScannerPort {
  return {
    async scan(absolutePath) {
      let socket: Socket | null = null;

      try {
        return await new Promise<ScanOutcome>((resolve) => {
          /**
           * Exactly one resolution.
           *
           * A socket can produce `error` after `timeout`, or `close` after
           * `error`. Without this latch the first answer could be overwritten
           * by a later one — and the dangerous direction is a late event
           * replacing a refusal, so the latch is a security control and not
           * only tidiness.
           */
          let settled = false;
          const settle = (outcome: ScanOutcome): void => {
            if (settled) return;
            settled = true;
            socket?.destroy();
            resolve(outcome);
          };

          /**
           * Were ALL the bytes handed to the scanner?
           *
           * A verdict only covers what the scanner actually saw. If the file
           * read failed or the socket closed before the terminator was sent,
           * clamd judged a PREFIX of the file — and a prefix being clean says
           * nothing about the rest. Without this, a read error that races a
           * fast `OK` would clear a file the scanner never finished reading.
           */
          let sent = false;

          socket = connect({ host: options.host, port: options.port });
          socket.setTimeout(options.timeoutMs);

          const chunks: Buffer[] = [];

          socket.on('timeout', () => settle({ status: 'unavailable' }));
          socket.on('error', () => settle({ status: 'unavailable' }));
          socket.on('data', (chunk: Buffer) => chunks.push(chunk));
          socket.on('close', () => {
            const outcome = interpret(Buffer.concat(chunks).toString('utf8'));

            // A clean verdict is only honoured for a complete transfer.
            if (outcome.status === 'clean' && !sent) {
              settle({ status: 'unscannable' });
              return;
            }

            settle(outcome);
          });

          socket.on('connect', () => {
            const active = socket;
            if (active === null) return;

            active.write('zINSTREAM\0');

            const source = createReadStream(absolutePath);

            source.on('data', (chunk) => {
              const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              const header = Buffer.alloc(4);
              header.writeUInt32BE(body.byteLength, 0);
              active.write(Buffer.concat([header, body]));
            });

            // The file could not be read. That is not a clean result, and it
            // is not the scanner's fault either — it is unscannable.
            source.on('error', () => settle({ status: 'unscannable' }));
            source.on('end', () => {
              sent = true;
              active.write(TERMINATOR);
            });
          });
        });
      } catch {
        return { status: 'unavailable' };
      } finally {
        (socket as Socket | null)?.destroy();
      }
    },
  };
}

/**
 * Map clamd's reply onto the semantic result set.
 *
 * Raw scanner text never escapes this function. The caller receives a
 * category, and a signature name only for a genuine detection — clamd's error
 * strings can name paths and internal state, and forwarding them would put
 * scanner internals into application errors.
 *
 * THE DEFAULT IS NOT CLEAN. An empty, truncated or unrecognised reply is
 * `unavailable`, because "the scanner said something we do not understand" is
 * not evidence of safety.
 */
export function interpret(reply: string): ScanOutcome {
  const text = reply.trim();

  if (text === '') return { status: 'unavailable' };
  if (/\bERROR\b/u.test(text)) return { status: 'unscannable' };

  if (/\bFOUND\b/u.test(text)) {
    const match = /stream:\s*(.+?)\s+FOUND/u.exec(text);
    return { status: 'infected', signature: match?.[1] ?? null };
  }

  if (/\bOK\b/u.test(text)) return { status: 'clean' };

  return { status: 'unavailable' };
}
