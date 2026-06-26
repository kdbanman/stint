/**
 * BDD runner — parses the .feature files (real Gherkin via @cucumber/gherkin) and
 * runs every scenario against BOTH surfaces: @stint/core directly and the tt
 * executable. Running the identical spec twice is the proof of the full-parity
 * claim, §17 R8 (acceptance.html §05, §06).
 *
 * Requires the CLI to be built (packages/cli/dist) for the CliWorld.
 */
import { describe, it, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { CoreWorld, CliWorld, type World } from './world.js';
import { matchStep, type Ctx } from './steps.js';

const featuresDir = fileURLToPath(new URL('../../../../features', import.meta.url));
const cliBuilt = existsSync(fileURLToPath(new URL('../../../cli/dist/bin.js', import.meta.url)));

interface ParsedScenario {
  name: string;
  steps: string[];
}
interface ParsedFeature {
  name: string;
  scenarios: ParsedScenario[];
}

function parseFeature(text: string): ParsedFeature {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  const doc = parser.parse(text);
  const feature = doc.feature!;
  const background: string[] = [];
  const scenarios: ParsedScenario[] = [];
  for (const child of feature.children) {
    if (child.background) {
      background.push(...child.background.steps.map((s) => s.text));
    } else if (child.scenario) {
      scenarios.push({
        name: child.scenario.name,
        steps: [...background, ...child.scenario.steps.map((s) => s.text)],
      });
    }
  }
  return { name: feature.name, scenarios };
}

const features = readdirSync(featuresDir)
  .filter((f) => f.endsWith('.feature'))
  .map((f) => parseFeature(readFileSync(`${featuresDir}/${f}`, 'utf8')));

const worldFactories: { name: string; make: () => World }[] = [
  { name: 'core', make: () => new CoreWorld() },
];
if (cliBuilt) {
  worldFactories.push({ name: 'cli', make: () => new CliWorld() });
}

for (const factory of worldFactories) {
  describe(`BDD over ${factory.name}`, () => {
    beforeAll(() => {
      if (factory.name === 'cli' && !cliBuilt) {
        throw new Error('CLI not built; run `npm run build` before the BDD suite');
      }
    });
    for (const feature of features) {
      describe(feature.name, () => {
        for (const scenario of feature.scenarios) {
          it(scenario.name, () => {
            const world = factory.make();
            const ctx: Ctx = { entryIds: [] };
            try {
              for (const text of scenario.steps) {
                const { def, args } = matchStep(text);
                def.run(world, ctx, ...args);
              }
            } finally {
              world.dispose();
            }
          });
        }
      });
    }
  });
}
