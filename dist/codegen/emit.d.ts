import { IntrospectedSchema } from './types';
export interface EmitOptions {
    /**
     * The command printed in the generated header so whoever reads the file
     * in six months knows how to refresh it. Defaults to the bare CLI name.
     */
    regenerateCommand?: string;
}
/** Default command shown in the generated header. */
export declare const DEFAULT_REGENERATE_COMMAND = "npx xenition-codegen --out <this file>";
/**
 * Render an introspected schema as a `.d.ts`.
 *
 * Pure: same schema in, byte-identical text out. That is not a nicety — a
 * generated file is committed, and one that reorders itself or stamps the
 * time of the run produces a diff on every regeneration until people stop
 * reading the diffs, at which point a renamed column slips through
 * unnoticed and the whole exercise has bought nothing.
 */
export declare function emitDatabaseTypes(schema: IntrospectedSchema, options?: EmitOptions): string;
/**
 * Table and column names come from the database, where `order-items`,
 * `2024 totals` and `select` are all legal. Emitting one of those bare
 * produces a `.d.ts` that does not parse, which fails at the point of
 * greatest confusion — a generated file the reader did not write. Reserved
 * words need no quoting: they are valid property names in a type literal.
 */
export declare function quoteIdentifier(name: string): string;
/**
 * Codepoint order, deliberately not `localeCompare`. Locale collation
 * differs between machines and ICU builds, so sorting table names with it
 * would reorder the generated file when a colleague regenerates it —
 * exactly the spurious diff this generator promises not to produce.
 */
export declare function compareIdentifiers(a: string, b: string): number;
//# sourceMappingURL=emit.d.ts.map