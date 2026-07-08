"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineModule = defineModule;
const MODULE_NAME_RE = /^[a-z][a-z0-9-]*$/;
/**
 * Declares a module. Purely declarative — nothing runs until
 * `client.modules.enable(name)` executes the migration set.
 */
function defineModule(definition) {
    if (typeof definition.name !== 'string' || !MODULE_NAME_RE.test(definition.name)) {
        throw new Error(`defineModule: "name" must be kebab-case ([a-z][a-z0-9-]*), got ${JSON.stringify(definition.name)}.`);
    }
    if (!Array.isArray(definition.migrations)) {
        throw new Error(`defineModule: module "${definition.name}" needs a migrations array.`);
    }
    if (typeof definition.factory !== 'function') {
        throw new Error(`defineModule: module "${definition.name}" needs a factory function.`);
    }
    return Object.freeze({
        name: definition.name,
        migrations: [...definition.migrations],
        factory: definition.factory,
    });
}
//# sourceMappingURL=core.js.map