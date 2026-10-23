import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|vue)$/.test(path) ? [path] : [];
  });
}

it('模块依赖保持单向，跨模块仅使用公开 Interface', () => {
  const violations: string[] = [];
  for (const directory of ['app/src', 'server/src', 'packages/contracts/src']) {
    for (const file of sourceFiles(resolve(root, directory))) {
      const text = readFileSync(file, 'utf8');
      const script = file.endsWith('.vue') ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1]).join('\n') : text;
      const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const from = relative(root, file);
      function checkImport(specifier: string) {
        const target = specifier.startsWith('.') ? relative(root, resolve(dirname(file), specifier)) : specifier;
        const report = () => violations.push(`${from} -> ${specifier}`);
        if (from.startsWith('packages/contracts/') && !target.startsWith('packages/contracts/')) report();
        if (from.startsWith('app/') && (target.startsWith('server/') || /^@bossok\/server(?:\/|$)/.test(target))) report();
        if (from.startsWith('server/') && (target.startsWith('app/') || /^@bossok\/app(?:\/|$)/.test(target))) report();
        if (target.startsWith('packages/contracts/') && !from.startsWith('packages/contracts/')) report();
        if (from.startsWith('app/src/features/') && /app\/src\/(platform\/|application|config)/.test(target)) report();
        if (from.startsWith('server/src/infrastructure/') && /server\/src\/(modules\/|http\/|app\.|config\.)/.test(target)) report();
        if (from.startsWith('server/src/modules/') && /server\/src\/(app\.|index\.|config\.)/.test(target)) report();
        for (const prefix of ['server/src/modules/', 'app/src/features/']) {
          if (target.startsWith(prefix)) {
            const targetModule = target.slice(prefix.length).split('/')[0];
            const fromModule = from.startsWith(prefix) ? from.slice(prefix.length).split('/')[0] : undefined;
            if (fromModule !== targetModule && !/\/index(?:\.[jt]s)?$/.test(target)) report();
          }
        }
      }
      function visit(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          checkImport(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node.arguments[0].text);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  expect(violations).toEqual([]);
});
