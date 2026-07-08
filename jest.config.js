/**
 * Jest config — ts-jest over the src tree.
 *
 * Tests live next to the code they cover as `<file>.spec.ts`. `npm test`
 * runs the whole suite; no `--passWithNoTests` escape hatch, so CI goes
 * red when the suite is empty or broken.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.spec.ts'],
  clearMocks: true,
};
