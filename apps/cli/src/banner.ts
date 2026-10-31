import { VERSION } from "./version.js";

/** The <> mark with its name and version beside it, for `tats agent` and a person's terminal. */

export const BANNER = [
  "   ▄█▀   ▀█▄",
  " ▄█▀       ▀█▄   Powered by Tacit",
  ` ▀█▄       ▄█▀   v${VERSION}`,
  "   ▀█▄   ▄█▀",
].join("\n");
