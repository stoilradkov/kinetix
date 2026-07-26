#!/usr/bin/env node
import "dotenv/config";

import { cliErrorMessage, cliExitCode } from "#src/api-error";
import { createProgram } from "#src/command";

try {
    await createProgram().parseAsync(process.argv);
} catch (error) {
    console.error(cliErrorMessage(error));
    process.exitCode = cliExitCode(error);
}
