#!/usr/bin/env node
import "dotenv/config";

import { createProgram } from "#src/command";

await createProgram().parseAsync(process.argv);
