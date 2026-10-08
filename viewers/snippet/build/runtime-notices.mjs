import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';

function collectPackage(file, packages) {
  let directory = dirname(file.split('?')[0]);
  while (dirname(directory) !== directory) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name) {
        if (manifest.name.startsWith('@embedpdf/')) return;
        const hasLicense = readdirSync(directory).some((file) =>
          /^(license|licence|copying|copyright(?:notice)?)([-_.]|$)/iu.test(file),
        );
        const parent = dirname(directory);
        const packageRoot =
          basename(parent) === 'node_modules' ||
          (basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules');
        if (hasLicense || packageRoot) {
          packages.set(`${manifest.name}@${manifest.version}`, { directory, manifest });
          return;
        }
      }
    }
    directory = dirname(directory);
  }
}

export function runtimeNotices() {
  return {
    name: 'snippet-runtime-notices',
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!module.renderedLength || !isAbsolute(id) || !id.includes('node_modules')) continue;
          collectPackage(id, packages);
        }
      }
      // Babel's bundled helpers are virtual modules rather than resolved runtime files.
      const require = createRequire(import.meta.url);
      collectPackage(
        require.resolve('@babel/helpers', { paths: [dirname(require.resolve('@babel/core'))] }),
        packages,
      );
      const text = [];
      for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const licenses = readdirSync(directory).filter((file) =>
          /^(license|licence|copying|copyright(?:notice)?)([-_.]|$)/iu.test(file),
        );
        if (!licenses.length) throw new Error(`Snippet runtime license text missing: ${name}`);
        text.push(`===== ${name} (${manifest.license ?? 'see license text'}) =====`);
        for (const file of licenses.sort()) text.push(readFileSync(join(directory, file), 'utf8'));
      }
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-notices.txt',
        source: `${text.join('\n\n')}\n`,
      });
    },
  };
}
