// MUST FAIL — but as `unreadable-tsconfig`, not as a clean pass.
//
// This file imports through an alias its workspace declares. The declaration
// lives in a tsconfig that does not parse, so the analyser cannot reproduce how
// the build resolves this specifier. Falling back to permissive defaults would
// classify the import as harmless and report the workspace clean — which is
// exactly the silent disappearance from enforcement that Review #3 punished
// elsewhere. An unverifiable file is not a passing file.
import { canon } from '~/contexts/quran';

export const used = canon;
