/**
 * How long expand / collapse and drop-induced position shifts transition.
 * Used both as the JS-side flash window (the canvas wears the
 * `is-animating` class for this many ms) and as the CSS transition duration.
 *
 * Kept short: a longer animation feels sluggish at high tree depths because
 * cascaded shifts compose visually.
 */
export const TV_ANIMATION_DURATION_MS = 200;
