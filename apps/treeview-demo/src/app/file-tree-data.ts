import { buildFromHierarchy, CollapseNode } from '@gradii/treeview';

interface FileEntry {
  id: string;
  text: string;
  children?: FileEntry[];
}

/**
 * Small semantic dataset for the Stage 2 hierarchy-binding demo. Folders carry
 * `children`, files are leaves. `blockSize: 0` keeps every leaf as a direct
 * Row sibling (no Block chunking) — a tiny tree reads more clearly without it.
 */
const FILE_TREE: FileEntry[] = [
  {
    id: 'docs',
    text: 'docs',
    children: [
      {
        id: 'docs/guide',
        text: 'guide',
        children: [
          { id: 'docs/guide/intro.md', text: 'intro.md' },
          { id: 'docs/guide/install.md', text: 'install.md' },
          { id: 'docs/guide/config.md', text: 'config.md' },
          { id: 'docs/guide/faq.md', text: 'faq.md' },
        ],
      },
      {
        id: 'docs/api',
        text: 'api',
        children: [
          { id: 'docs/api/v1.md', text: 'v1.md' },
          { id: 'docs/api/v2.md', text: 'v2.md' },
          { id: 'docs/api/changelog.md', text: 'changelog.md' },
        ],
      },
    ],
  },
  {
    id: 'src',
    text: 'src',
    children: [
      {
        id: 'src/app',
        text: 'app',
        children: [
          { id: 'src/app/app.ts', text: 'app.ts' },
          { id: 'src/app/app.html', text: 'app.html' },
          { id: 'src/app/app.scss', text: 'app.scss' },
          { id: 'src/app/app.routes.ts', text: 'app.routes.ts' },
        ],
      },
      {
        id: 'src/lib',
        text: 'lib',
        children: [
          { id: 'src/lib/tree-model.ts', text: 'tree-model.ts' },
          { id: 'src/lib/virtual-layout.ts', text: 'virtual-layout.ts' },
          { id: 'src/lib/expand.ts', text: 'expand.ts' },
          { id: 'src/lib/selection.ts', text: 'selection.ts' },
          { id: 'src/lib/check.ts', text: 'check.ts' },
        ],
      },
      { id: 'src/main.ts', text: 'main.ts' },
      { id: 'src/styles.scss', text: 'styles.scss' },
    ],
  },
  { id: 'README.md', text: 'README.md' },
  { id: 'package.json', text: 'package.json' },
  { id: 'tsconfig.json', text: 'tsconfig.json' },
];

export function buildFileTree(): CollapseNode {
  return buildFromHierarchy(FILE_TREE, {
    childrenField: 'children',
    textField: 'text',
    idField: 'id',
    blockSize: 0,
    rootLabel: 'workspace',
  });
}
