// The text-matching helpers live in the shared package now, so a game or a
// comic can be matched against a catalogue with the same rules. This path is
// kept so nothing in this app, or its tests, had to move.
export { normalizeNumber, numberPart, round2, sameNumber, setSimilarity, similarity, toNumber, tokenOverlap, tokens } from "@collectcollect/core/pricing/match";
