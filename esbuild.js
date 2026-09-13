const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  sourcemap: true,
  minify: false
};

async function build() {
  if (watch) {
    const context = await esbuild.context(options);

    await context.watch();
    return;
  }

  await esbuild.build(options);
}

build().catch(() => process.exit(1));