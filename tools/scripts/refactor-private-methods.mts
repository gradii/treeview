/**
 * Codemod: prefix every TypeScript `private` method with `_`.
 *
 * Renames go through the TypeScript language service (ts-morph), so all
 * references are updated as well. Already-prefixed methods are skipped,
 * which makes the script idempotent. A rename is skipped with a warning
 * if the target name would collide with an existing class member.
 *
 * Note: only `private` *methods* are renamed — properties, accessors and
 * constructor parameter properties are left untouched. Angular templates
 * are not scanned; private methods are not reachable from external
 * templates written by this repo, but verify with a build after running.
 *
 * Usage:
 *   pnpm refactor:private-methods            # apply
 *   pnpm refactor:private-methods --dry-run  # preview only
 */
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node, Project, Scope, SyntaxKind } from 'ts-morph';
import type { ClassDeclaration, ClassExpression, MethodDeclaration } from 'ts-morph';

const dryRun = process.argv.includes('--dry-run');
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const project = new Project({
  tsConfigFilePath: join(rootDir, 'tsconfig.base.json'),
  skipAddingFilesFromTsConfig: true,
});

project.addSourceFilesAtPaths([
  join(rootDir, 'apps/**/*.ts'),
  join(rootDir, 'libs/**/*.ts'),
  '!**/node_modules/**',
  '!**/*.d.ts',
]);

type ClassLike = ClassDeclaration | ClassExpression;

const candidates: Array<{ klass: ClassLike; method: MethodDeclaration }> = [];

for (const sourceFile of project.getSourceFiles()) {
  const classes: ClassLike[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ];
  for (const klass of classes) {
    for (const member of klass.getMembers()) {
      if (!Node.isMethodDeclaration(member)) continue;
      if (member.getScope() !== Scope.Private) continue;
      // Computed/string names can't be renamed reliably.
      if (!Node.isIdentifier(member.getNameNode())) continue;
      if (member.getName().startsWith('_')) continue;
      candidates.push({ klass, method: member });
    }
  }
}

let renamed = 0;
const skipped: string[] = [];

for (const { klass, method } of candidates) {
  // Renaming one overload signature renames the whole overload group, so
  // later entries of the same group show up here already prefixed.
  if (method.wasForgotten()) continue;
  const name = method.getName();
  if (name.startsWith('_')) continue;

  const target = `_${name}`;
  const className = klass.getName() ?? '<anonymous>';
  const file = relative(rootDir, method.getSourceFile().getFilePath());

  const collides =
    klass.getMethod(target) ??
    klass.getProperty(target) ??
    klass.getGetAccessor(target) ??
    klass.getSetAccessor(target);
  if (collides) {
    skipped.push(`${file}: ${className}.${name} — "${target}" already exists`);
    continue;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}${file}: ${className}.${name} -> ${target}`);
  if (!dryRun) method.rename(target);
  renamed++;
}

if (!dryRun) project.saveSync();

console.log(`\n${dryRun ? 'Would rename' : 'Renamed'} ${renamed} private method(s).`);
if (skipped.length > 0) {
  console.warn(`Skipped ${skipped.length} due to name collisions:`);
  for (const line of skipped) console.warn(`  - ${line}`);
  process.exitCode = 1;
}
