import { defineConfig } from "@savvy-web/github-action-builder";

export default defineConfig({
	entries: {
		main: "src/main.ts",
		post: "src/post.ts",
	},
	build: {
		minify: true,
	},
	persistLocal: {
		enabled: true,
		path: ".github/actions/local",
	},
});
