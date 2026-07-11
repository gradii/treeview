/**
 * Codemod: prefix every TypeScript `protected` class member with `_`.
 *
 * Unlike `private`, protected members ARE reachable from Angular templates
 * and host-binding expressions, so this script rewrites three surfaces:
 *   1. TypeScript declarations + references — via the TS language service
 *      (ts-morph `rename`, symbol-aware).
 *   2. Component templates (inline `template:` literals and external
 *      `templateUrl` HTML files) — via @angular/compiler's `parseTemplate`,
 *      rewriting only implicit-receiver reads (`foo()`, `this.foo`) whose
 *      name matches a renamed member of THAT component. Attribute/input
 *      NAMES and reads through other receivers (`x.foo`) are never touched.
 *   3. `host: {...}` metadata expression values — via the compiler's
 *      expression parser (`parseBinding` / `parseAction`).
 *
 * Safety rules:
 *   - Template-local declarations (`@let x`, `@for (x of ...)`, `#ref`,
 *     `let-x`, `@if (...; as x)`) shadow class members, so any member name
 *     that collides with a template local is NOT rewritten in that template
 *     and is reported for manual review.
 *   - Members named like Angular lifecycle hooks (`ng*`), members backed by
 *     `input()`/`output()`/`model()` (public binding surface), already
 *     `_`-prefixed members, and computed names are skipped with a warning.
 *   - A rename is skipped if `_name` already exists on the class.
 *   - Every planned string edit is validated against the source text before
 *     splicing; a template whose literal contains escapes/interpolation
 *     (raw text != cooked text) is skipped with a warning rather than
 *     rewritten on unreliable offsets.
 *
 * Usage:
 *   pnpm refactor:protected-members            # apply
 *   pnpm refactor:protected-members --dry-run  # preview only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node, Project, Scope, SyntaxKind } from 'ts-morph';
import type {
  ClassDeclaration,
  ClassExpression,
  ObjectLiteralExpression,
  SourceFile,
} from 'ts-morph';
import {
  ImplicitReceiver,
  Lexer,
  ParseLocation,
  ParseSourceFile,
  ParseSourceSpan,
  Parser,
  RecursiveAstVisitor,
  ThisReceiver,
  TmplAstRecursiveVisitor,
  parseTemplate,
  tmplAstVisitAll,
} from '@angular/compiler';
import type { AST, TmplAstNode } from '@angular/compiler';

const dryRun = process.argv.includes('--dry-run');
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p: string) => relative(rootDir, p);

const warnings: string[] = [];
const actions: string[] = [];
const note = (msg: string) => {
  actions.push(msg);
  console.log(`${dryRun ? '[dry-run] ' : ''}${msg}`);
};
const warn = (msg: string) => {
  warnings.push(msg);
  console.warn(`WARN: ${msg}`);
};

// ---------------------------------------------------------------------------
// Part 1 — collect protected members per class
// ---------------------------------------------------------------------------

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
type RenamableNode = Node & { rename(newName: string): Node; getName(): string | undefined };

interface PlannedRename {
  klass: ClassLike;
  node: RenamableNode;
  name: string;
  /** instance members are visible to templates/host bindings; statics are not */
  instance: boolean;
}

const BINDING_FACTORY_INITIALIZERS = new Set(['input', 'output', 'model']);

function initializerFactoryName(member: Node): string | null {
  if (!Node.isPropertyDeclaration(member)) return null;
  const init = member.getInitializer();
  if (init === undefined || !Node.isCallExpression(init)) return null;
  const expr = init.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) {
    const base = expr.getExpression();
    if (Node.isIdentifier(base)) return base.getText(); // input.required(...)
  }
  return null;
}

function classLabel(klass: ClassLike): string {
  return klass.getName() ?? '<anonymous>';
}

function hasMemberNamed(klass: ClassLike, name: string): boolean {
  if (
    klass.getMethod(name) !== undefined ||
    klass.getProperty(name) !== undefined ||
    klass.getGetAccessor(name) !== undefined ||
    klass.getSetAccessor(name) !== undefined
  ) {
    return true;
  }
  return klass
    .getConstructors()
    .some((ctor) => ctor.getParameters().some((p) => p.getName() === name));
}

const allClasses: ClassLike[] = [];
for (const sourceFile of project.getSourceFiles()) {
  allClasses.push(
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassExpression),
  );
}

const planned: PlannedRename[] = [];

for (const klass of allClasses) {
  const file = rel(klass.getSourceFile().getFilePath());
  const cls = classLabel(klass);

  const consider = (node: RenamableNode, name: string, instance: boolean) => {
    if (name.startsWith('_')) return; // already conforming (also makes reruns idempotent)
    if (/^ng[A-Z]/.test(name)) {
      warn(`${file}: ${cls}.${name} — looks like an Angular lifecycle/compiler hook; skipped`);
      return;
    }
    const factory = initializerFactoryName(node);
    if (factory !== null && BINDING_FACTORY_INITIALIZERS.has(factory)) {
      warn(`${file}: ${cls}.${name} — ${factory}() members are public binding surface; skipped`);
      return;
    }
    if (hasMemberNamed(klass, `_${name}`)) {
      warn(`${file}: ${cls}.${name} — "_${name}" already exists on the class; skipped`);
      return;
    }
    planned.push({ klass, node, name, instance });
  };

  for (const member of klass.getMembers()) {
    if (
      Node.isMethodDeclaration(member) ||
      Node.isPropertyDeclaration(member) ||
      Node.isGetAccessorDeclaration(member) ||
      Node.isSetAccessorDeclaration(member)
    ) {
      if (member.getScope() !== Scope.Protected) continue;
      const nameNode = member.getNameNode();
      if (!Node.isIdentifier(nameNode)) {
        warn(`${file}: ${cls} has a protected member with a computed/string name; skipped`);
        continue;
      }
      consider(member, member.getName(), !member.isStatic());
    }
  }

  // Constructor parameter properties (`constructor(protected foo: Bar)`)
  for (const ctor of klass.getConstructors()) {
    for (const param of ctor.getParameters()) {
      const isProtected = param
        .getModifiers()
        .some((m) => m.getKind() === SyntaxKind.ProtectedKeyword);
      if (!isProtected) continue;
      consider(param as unknown as RenamableNode, param.getName(), true);
    }
  }
}

// ---------------------------------------------------------------------------
// Part 2 — TS symbol renames (language-service backed)
// ---------------------------------------------------------------------------

// Per-class old->new map of INSTANCE members, used for template/host rewriting.
const templateRenameMap = new Map<ClassLike, Map<string, string>>();
let tsRenamed = 0;

for (const { klass, node, name, instance } of planned) {
  if (node.wasForgotten()) continue;
  const current = node.getName();
  if (current === undefined || current.startsWith('_')) continue; // overload group already handled
  const target = `_${name}`;
  note(`${rel(klass.getSourceFile().getFilePath())}: ${classLabel(klass)}.${name} -> ${target} (ts)`);
  if (!dryRun) node.rename(target);
  tsRenamed++;
  if (instance) {
    let map = templateRenameMap.get(klass);
    if (map === undefined) templateRenameMap.set(klass, (map = new Map()));
    map.set(name, target);
  }
}

// ---------------------------------------------------------------------------
// Part 3 — Angular template & host-metadata rewriting
// ---------------------------------------------------------------------------

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Collects implicit-receiver (`foo` / `this.foo`) name reads matching `names`. */
class MemberReadCollector extends RecursiveAstVisitor {
  readonly edits: Edit[] = [];
  private readonly source: string;
  private readonly names: Map<string, string>;
  private readonly locals: ReadonlySet<string>;
  private readonly onShadowed: (name: string) => void;
  constructor(
    source: string,
    names: Map<string, string>,
    locals: ReadonlySet<string>,
    onShadowed: (name: string) => void,
  ) {
    super();
    this.source = source;
    this.names = names;
    this.locals = locals;
    this.onShadowed = onShadowed;
  }
  private handle(ast: { receiver: AST; name: string; nameSpan: { start: number; end: number } }): void {
    const implicit =
      ast.receiver instanceof ImplicitReceiver || ast.receiver instanceof ThisReceiver;
    if (!implicit) return;
    const replacement = this.names.get(ast.name);
    if (replacement === undefined) return;
    if (this.locals.has(ast.name)) {
      this.onShadowed(ast.name);
      return;
    }
    const { start, end } = ast.nameSpan;
    if (this.source.slice(start, end) !== ast.name) {
      throw new Error(
        `nameSpan mismatch for "${ast.name}" at [${start},${end}] — got "${this.source.slice(start, end)}"`,
      );
    }
    this.edits.push({ start, end, replacement });
  }
  override visitPropertyRead(ast: any, context: any): void {
    this.handle(ast);
    super.visitPropertyRead(ast, context);
  }
  override visitSafePropertyRead(ast: any, context: any): void {
    // `x?.foo` never has an implicit receiver, but stay future-proof.
    this.handle(ast);
    super.visitSafePropertyRead(ast, context);
  }
}

/** Walks the template AST: pass 1 collects local names, pass 2 collects expression edits. */
class TemplateWalker extends TmplAstRecursiveVisitor {
  private readonly expr: ((ast: AST | null | undefined) => void) | null;
  private readonly locals: Set<string> | null;
  constructor(
    expr: ((ast: AST | null | undefined) => void) | null,
    locals: Set<string> | null,
  ) {
    super();
    this.expr = expr;
    this.locals = locals;
  }
  private declare_(name: string | undefined): void {
    if (this.locals !== null && name !== undefined) this.locals.add(name);
  }
  override visitElement(el: any): void {
    for (const r of el.references ?? []) this.declare_(r.name);
    for (const i of el.inputs ?? []) this.expr?.(i.value);
    for (const o of el.outputs ?? []) this.expr?.(o.handler);
    super.visitElement(el);
  }
  override visitTemplate(t: any): void {
    for (const r of t.references ?? []) this.declare_(r.name);
    for (const v of t.variables ?? []) this.declare_(v.name);
    for (const i of t.inputs ?? []) this.expr?.(i.value);
    for (const o of t.outputs ?? []) this.expr?.(o.handler);
    // Structural-directive microsyntax (`*ngIf="expr"`) binds via templateAttrs,
    // not inputs; text attrs in there carry a plain string value — skip those.
    for (const a of t.templateAttrs ?? []) {
      if (a?.value != null && typeof a.value.visit === 'function') this.expr?.(a.value);
    }
    super.visitTemplate(t);
  }
  override visitBoundText(t: any): void {
    this.expr?.(t.value);
  }
  override visitBoundAttribute(a: any): void {
    this.expr?.(a.value);
  }
  override visitBoundEvent(e: any): void {
    this.expr?.(e.handler);
  }
  override visitIfBlockBranch(b: any): void {
    this.expr?.(b.expression);
    if (b.expressionAlias != null) this.declare_(b.expressionAlias.name);
    super.visitIfBlockBranch(b);
  }
  override visitForLoopBlock(b: any): void {
    this.declare_(b.item?.name);
    for (const v of b.contextVariables ?? []) this.declare_(v.name);
    this.expr?.(b.expression);
    this.expr?.(b.trackBy);
    super.visitForLoopBlock(b);
  }
  override visitSwitchBlock(b: any): void {
    this.expr?.(b.expression);
    super.visitSwitchBlock(b);
  }
  override visitSwitchBlockCase(b: any): void {
    this.expr?.(b.expression);
    super.visitSwitchBlockCase(b);
  }
  override visitDeferredBlock(b: any): void {
    for (const t of Object.values(b.triggers ?? {})) this.expr?.((t as any)?.value);
    for (const t of Object.values(b.prefetchTriggers ?? {})) this.expr?.((t as any)?.value);
    super.visitDeferredBlock(b);
  }
  override visitLetDeclaration(l: any): void {
    this.declare_(l.name);
    this.expr?.(l.value);
  }
}

function applyEdits(source: string, edits: Edit[]): string {
  // Two-way bindings report the same span twice — dedupe, then splice descending.
  const unique = new Map<string, Edit>();
  for (const e of edits) unique.set(`${e.start}:${e.end}`, e);
  const sorted = [...unique.values()].sort((a, b) => b.start - a.start);
  let prevStart = Infinity;
  let out = source;
  for (const e of sorted) {
    if (e.end > prevStart) throw new Error('overlapping template edits');
    prevStart = e.start;
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

/** Returns the rewritten template text, or null if nothing changed. */
function rewriteTemplateText(
  templateText: string,
  names: Map<string, string>,
  context: string,
): string | null {
  const parsed = parseTemplate(templateText, context, {
    preserveWhitespaces: true,
    preserveLineEndings: true,
  });
  if (parsed.errors !== null && parsed.errors.length > 0) {
    warn(`${context}: template parse errors — left untouched: ${parsed.errors.map((e) => e.msg).join('; ')}`);
    return null;
  }
  const locals = new Set<string>();
  tmplAstVisitAll(new TemplateWalker(null, locals), parsed.nodes as TmplAstNode[]);

  const shadowed = new Set<string>();
  const collector = new MemberReadCollector(templateText, names, locals, (n) => shadowed.add(n));
  tmplAstVisitAll(
    new TemplateWalker((ast) => ast?.visit(collector), null),
    parsed.nodes as TmplAstNode[],
  );
  for (const name of shadowed) {
    warn(
      `${context}: reads of "${name}" skipped — a template local (#ref/@let/@for/let-) with that name shadows the class member; review manually`,
    );
  }
  if (collector.edits.length === 0) return null;
  return applyEdits(templateText, collector.edits);
}

const exprParser = new Parser(new Lexer());

function parseHostExpression(value: string, key: string): AST | null {
  const sf = new ParseSourceFile(value, 'host');
  const span = new ParseSourceSpan(
    new ParseLocation(sf, 0, 0, 0),
    new ParseLocation(sf, value.length, 0, value.length),
  );
  const result = key.startsWith('(')
    ? exprParser.parseAction(value, span, 0)
    : exprParser.parseBinding(value, span, 0);
  if (result.errors.length > 0) return null;
  return result.ast;
}

function decoratorMetadata(klass: ClassLike): ObjectLiteralExpression | null {
  for (const name of ['Component', 'Directive']) {
    const dec = Node.isClassDeclaration(klass) ? klass.getDecorator(name) : undefined;
    if (dec === undefined) continue;
    const arg = dec.getArguments()[0];
    if (arg !== undefined && Node.isObjectLiteralExpression(arg)) return arg;
  }
  return null;
}

let templateEdits = 0;
let hostEdits = 0;
const htmlWrites = new Map<string, string>();

for (const [klass, names] of templateRenameMap) {
  const meta = decoratorMetadata(klass);
  if (meta === null) continue;
  const cls = classLabel(klass);
  const file = rel(klass.getSourceFile().getFilePath());

  // --- inline template ---
  const templateProp = meta.getProperty('template');
  if (templateProp !== undefined && Node.isPropertyAssignment(templateProp)) {
    const init = templateProp.getInitializer();
    if (
      init !== undefined &&
      (Node.isNoSubstitutionTemplateLiteral(init) || Node.isStringLiteral(init))
    ) {
      const raw = init.getText().slice(1, -1);
      if (raw !== init.getLiteralText()) {
        warn(`${file}: ${cls} inline template contains escapes/interpolation — left untouched; review manually`);
      } else {
        const rewritten = rewriteTemplateText(raw, names, `${file} (${cls} inline template)`);
        if (rewritten !== null) {
          const quote = init.getText()[0];
          note(`${file}: ${cls} inline template — rewrote member references`);
          if (!dryRun) init.replaceWithText(`${quote}${rewritten}${quote}`);
          templateEdits++;
        }
      }
    } else if (init !== undefined) {
      warn(`${file}: ${cls} template is not a plain literal (${init.getKindName()}); review manually`);
    }
  }

  // --- external template ---
  const urlProp = meta.getProperty('templateUrl');
  if (urlProp !== undefined && Node.isPropertyAssignment(urlProp)) {
    const init = urlProp.getInitializer();
    if (init !== undefined && Node.isStringLiteral(init)) {
      const htmlPath = resolve(dirname(klass.getSourceFile().getFilePath()), init.getLiteralText());
      let html: string;
      try {
        html = htmlWrites.get(htmlPath) ?? readFileSync(htmlPath, 'utf8');
      } catch {
        warn(`${file}: ${cls} templateUrl "${init.getLiteralText()}" could not be read`);
        html = '';
      }
      if (html !== '') {
        const rewritten = rewriteTemplateText(html, names, rel(htmlPath));
        if (rewritten !== null) {
          note(`${rel(htmlPath)}: rewrote ${cls} member references`);
          htmlWrites.set(htmlPath, rewritten);
          templateEdits++;
        }
      }
    }
  }

  // --- host metadata ---
  const hostProp = meta.getProperty('host');
  if (hostProp !== undefined && Node.isPropertyAssignment(hostProp)) {
    const hostObj = hostProp.getInitializer();
    if (hostObj !== undefined && Node.isObjectLiteralExpression(hostObj)) {
      for (const prop of hostObj.getProperties()) {
        if (!Node.isPropertyAssignment(prop)) continue;
        const keyNode = prop.getNameNode();
        const key = Node.isStringLiteral(keyNode) ? keyNode.getLiteralText() : keyNode.getText();
        if (!key.startsWith('[') && !key.startsWith('(')) continue; // static attr — no expression
        const valueNode = prop.getInitializer();
        if (valueNode === undefined || !Node.isStringLiteral(valueNode)) continue;
        const value = valueNode.getLiteralText();
        const rawValue = valueNode.getText().slice(1, -1);
        if (rawValue !== value) {
          warn(`${file}: ${cls} host "${key}" value contains escapes — left untouched; review manually`);
          continue;
        }
        const ast = parseHostExpression(value, key);
        if (ast === null) {
          warn(`${file}: ${cls} host "${key}" expression failed to parse — left untouched`);
          continue;
        }
        const collector = new MemberReadCollector(value, names, new Set(), () => {});
        ast.visit(collector);
        if (collector.edits.length === 0) continue;
        const rewritten = applyEdits(value, collector.edits);
        note(`${file}: ${cls} host "${key}": "${value}" -> "${rewritten}"`);
        if (!dryRun) valueNode.setLiteralValue(rewritten);
        hostEdits++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Part 4 — persist & report
// ---------------------------------------------------------------------------

if (!dryRun) {
  project.saveSync();
  for (const [path, content] of htmlWrites) writeFileSync(path, content, 'utf8');
}

console.log(
  `\n${dryRun ? 'Would rename' : 'Renamed'} ${tsRenamed} protected member(s); ` +
    `${templateEdits} template(s) and ${hostEdits} host binding(s) rewritten.`,
);
if (warnings.length > 0) {
  console.warn(`\n${warnings.length} warning(s) need review:`);
  for (const w of warnings) console.warn(`  - ${w}`);
  process.exitCode = 1;
}
