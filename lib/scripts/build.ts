import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require: NodeJS.Require = createRequire(import.meta.url);

interface NccOptions {
	cache?: string | false;
	externals?: string[];
	filterAssetBase?: string;
	minify?: boolean;
	sourceMap?: boolean;
	assetBuilds?: boolean;
	sourceMapBasePrefix?: string;
	sourceMapRegister?: boolean;
	watch?: boolean;
	license?: string;
	target?: string;
	v8cache?: boolean;
	quiet?: boolean;
	debugLog?: boolean;
}

interface NccResult {
	code: string;
	map: string | undefined;
	assets: Record<string, { source: string; permissions?: number; symlinks?: string[] }>;
}

type NccFunction = (input: string, options?: NccOptions) => Promise<NccResult>;

const ncc: NccFunction = require("@vercel/ncc");

interface BuildEntry {
	entry: string;
	output: string;
}

const entries: BuildEntry[] = [
	{ entry: "src/pre.ts", output: "dist/pre.js" },
	{ entry: "src/main.ts", output: "dist/main.js" },
	{ entry: "src/post.ts", output: "dist/post.js" },
];

async function buildEntry({ entry, output }: BuildEntry): Promise<void> {
	const entryPath = resolve(entry);
	const outputDir = output.replace(/\/[^/]+$/, "");

	console.log(`Building ${entry} -> ${output}...`);

	const { code, map } = await ncc(entryPath, {
		minify: true,
		target: "es2022",
		externals: [],
	});

	// Write the output manually since ncc returns the code
	await mkdir(outputDir, { recursive: true });
	await writeFile(output, code);

	if (map) {
		await writeFile(`${output}.map`, map);
	}

	console.log(`✓ Built ${entry}`);
}

async function clean(): Promise<void> {
	try {
		await rm("dist", { recursive: true, force: true });
		console.log("✓ Cleaned dist directory\n");
	} catch {
		// Ignore errors if dist doesn't exist
	}
}

async function build(): Promise<void> {
	try {
		console.log("Building action files...\n");

		await clean();

		for (const entry of entries) {
			await buildEntry(entry);
		}

		// Create package.json in dist/ to mark files as ES modules
		await writeFile("dist/package.json", JSON.stringify({ type: "module" }, null, "\t"));
		console.log("✓ Created dist/package.json");

		console.log("\n✓ All builds completed successfully.");
	} catch (error) {
		console.error("\n✗ Build failed:", error);
		process.exit(1);
	}
}

await build();
