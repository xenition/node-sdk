#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("./cli");
/**
 * The `xenition-codegen` executable. Nothing but the process shell around
 * `main()`: argument handling, introspection and emission all live in
 * `cli.ts` where they can be called as a function and asserted on.
 *
 * The failure path is the reason this file exists at all. An unhandled
 * rejection in Node exits non-zero but prints a stack trace whose first
 * line is the least useful part; the message the generator went to trouble
 * to write is what a person needs, so it is printed on its own and the
 * stack is kept for `--stack`-less debugging only when there is no message.
 */
(0, cli_1.main)(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (!(error instanceof Error))
        console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=bin.js.map