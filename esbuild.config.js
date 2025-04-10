const esbuild = require('esbuild');

const commonConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  external: ['vscode'],
  sourcemap: true,
  outfile: 'dist/extension.js',
  logLevel: 'info'
};

// 生产环境配置
const prodConfig = {
  ...commonConfig,
  minify: true,
  sourcemap: false,
};

async function build() {
  try {
    if (process.argv.includes('--watch')) {
      const ctx = await esbuild.context(commonConfig);
      await ctx.watch();
    } else {
      await esbuild.build(prodConfig);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

build(); 