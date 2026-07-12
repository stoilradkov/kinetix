#!/usr/bin/env node
import 'dotenv/config';

import { createProgram } from './command.js';

await createProgram().parseAsync(process.argv);
