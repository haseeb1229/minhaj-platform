// FIXTURE — MUST FAIL.
// "No context depends on Prisma, the filesystem, or a search engine directly"
// (DOMAIN_MODEL.md §2 rule 7). Storage is reached through StorageService.
import { readFileSync } from 'node:fs';

export const raw = readFileSync('book.pdf');
