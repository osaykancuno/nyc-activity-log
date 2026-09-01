/**
 * Small mutable facts the pollers discover at run time.
 * Kept out of config so that "what the club is doing right now" never has to be
 * guessed from a hardcoded date.
 */
export const runtime = {
  /** True once the club's relay says the forge is open (or the operator forced it). */
  forgeArmed: false,
};
