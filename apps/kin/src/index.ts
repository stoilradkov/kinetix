#!/usr/bin/env node
import "dotenv/config";

import { createProgram } from "#src/command.js";

await createProgram().parseAsync(process.argv);
