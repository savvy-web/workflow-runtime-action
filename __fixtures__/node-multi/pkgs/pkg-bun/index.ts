// @ts-expect-error-error
// biome-ignore lint/correctness/noUndeclaredDependencies: Deno standard library is not declared as a dependency, but it's available in the Deno runtime
import { toCamelCase } from "@std/text";

// Example usage of imported functions
const camelCaseString = toCamelCase("hello world");
console.log(`Camel case: ${camelCaseString}`);
