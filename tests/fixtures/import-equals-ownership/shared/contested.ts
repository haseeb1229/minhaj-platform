// Review #7 (B2): the ONLY dependency this file declares is an
// `ImportEqualsDeclaration`. Both projects really compile it, and `#target`
// really resolves to different files under each — but the ownership
// compatibility comparison used its own cut-down specifier extractor that did
// not understand this syntax, so it saw a file with no imports, concluded there
// was nothing to disagree about, and the ambiguity vanished.
import target = require('#target');

export type Contested = target.Target;
