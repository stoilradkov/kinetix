import chalk from 'chalk';
import { Command } from 'commander';

import { parseCliEnv } from '@kinetix/config';
import { healthResponseSchema } from '@kinetix/types';

interface ProgramDependencies {
  fetch: typeof globalThis.fetch;
  output: (message: string) => void;
}

const defaults: ProgramDependencies = {
  fetch: globalThis.fetch,
  output: console.log,
};

export function createProgram(
  dependencies: ProgramDependencies = defaults,
): Command {
  const program = new Command();

  program
    .name('kin')
    .description('Command-line interface for Kinetix')
    .version('0.1.0');

  program
    .command('info')
    .description('Print local Kinetix CLI information')
    .action(() => {
      const { KINETIX_API_URL } = parseCliEnv(process.env);
      dependencies.output(chalk.bold('Kinetix'));
      dependencies.output(`API: ${KINETIX_API_URL}`);
    });

  const api = program
    .command('api')
    .description('Interact with the Kinetix API');

  api
    .command('status')
    .description('Check API liveness')
    .option('--api-url <url>', 'Override the Kinetix API URL')
    .action(async (options: { apiUrl?: string }) => {
      const env = parseCliEnv({
        ...process.env,
        ...(options.apiUrl ? { KINETIX_API_URL: options.apiUrl } : {}),
      });
      const response = await dependencies.fetch(
        `${env.KINETIX_API_URL}/health`,
      );

      if (!response.ok) {
        throw new Error(`Kinetix API returned HTTP ${response.status}`);
      }

      const health = healthResponseSchema.parse(await response.json());
      dependencies.output(
        `${chalk.green('●')} ${health.service} is ${health.status}`,
      );
    });

  return program;
}
