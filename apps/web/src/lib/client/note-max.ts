/**
 * The longest touch or close note: core's pipeline NOTE_MAX, which @tacit/core
 * does not export yet. logTouch cuts a note to it anyway; moveStage stores a
 * close note as given, so it is cut here. A file of its own because the bulk
 * dialog, a client component, needs it: a value import of anything that
 * imports @tacit/core ships all of that package to the browser.
 */
export const NOTE_MAX = 2000;
