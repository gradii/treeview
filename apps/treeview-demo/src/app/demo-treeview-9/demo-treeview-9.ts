import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  buildFromHierarchy,
  CollapseNode,
  Key,
  NodeTemplateDirective,
  TreeView,
} from '@gradii/treeview';

interface FileItem {
  id: string;
  name: string;
  kind: 'folder' | 'doc' | 'image' | 'code' | 'config';
  size?: string;
  children?: FileItem[];
}

const FILES: FileItem[] = [
  {
    id: 'docs',
    name: 'docs',
    kind: 'folder',
    children: [
      { id: 'docs/intro.md', name: 'intro.md', kind: 'doc', size: '4.2 KB' },
      { id: 'docs/api.md', name: 'api.md', kind: 'doc', size: '18.0 KB' },
      {
        id: 'docs/cover.png',
        name: 'cover.png',
        kind: 'image',
        size: '512 KB',
      },
    ],
  },
  {
    id: 'src',
    name: 'src',
    kind: 'folder',
    children: [
      {
        id: 'src/app',
        name: 'app',
        kind: 'folder',
        children: [
          {
            id: 'src/app/app.ts',
            name: 'app.ts',
            kind: 'code',
            size: '2.0 KB',
          },
          {
            id: 'src/app/app.scss',
            name: 'app.scss',
            kind: 'code',
            size: '0.6 KB',
          },
          {
            id: 'src/app/app.spec.ts',
            name: 'app.spec.ts',
            kind: 'code',
            size: '1.1 KB',
          },
        ],
      },
      { id: 'src/index.ts', name: 'index.ts', kind: 'code', size: '0.3 KB' },
    ],
  },
  { id: 'package.json', name: 'package.json', kind: 'config', size: '1.4 KB' },
  {
    id: 'tsconfig.json',
    name: 'tsconfig.json',
    kind: 'config',
    size: '0.8 KB',
  },
];

const ICONS: Record<FileItem['kind'], string> = {
  folder: '📁',
  doc: '📄',
  image: '🖼️',
  code: '⚙️',
  config: '🔧',
};

@Component({
  selector: 'app-demo-treeview-9',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView, NodeTemplateDirective],
  templateUrl: './demo-treeview-9.html',
  styleUrl: './demo-treeview-9.css',
})
export class DemoTreeview9 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy(FILES, {
      childrenField: 'children',
      textField: 'name',
      idField: 'id',
      blockSize: 0,
      rootLabel: 'workspace',
    }),
  );

  readonly selectedKeys = signal<ReadonlySet<Key>>(new Set());
  readonly checkedKeys = signal<ReadonlySet<Key>>(new Set());

  iconFor(item: FileItem | undefined): string {
    if (!item) return '•';
    return ICONS[item.kind] ?? '•';
  }
}
