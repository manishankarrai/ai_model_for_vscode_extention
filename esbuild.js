const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const production = process.env.NODE_ENV === "production";

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  sourcemap: !production,
  minify: production,
  drop: production ? ["console"] : []
};

async function build() {
  if (watch) {
    const context = await esbuild.context(options);

    await context.watch();

    console.log("MM3 esbuild watch started");
    return;
  }

  await esbuild.build(options);

  console.log("MM3 build complete");
}

build().catch(() => process.exit(1));