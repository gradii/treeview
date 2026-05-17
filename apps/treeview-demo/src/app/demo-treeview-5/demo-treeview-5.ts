import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  buildFromHierarchy,
  CollapseNode,
  FilterMode,
  FilterOperator,
  TreeView,
} from '@gradii/treeview';

interface Pkg {
  id: string;
  name: string;
  description?: string;
  packages?: Pkg[];
}

const NPM: Pkg[] = [
  {
    id: 'angular',
    name: '@angular',
    packages: [
      {
        id: 'angular/core',
        name: 'core',
        description: 'Reactive primitives + DI',
      },
      {
        id: 'angular/common',
        name: 'common',
        description: 'Pipes, NgIf, NgFor',
      },
      { id: 'angular/router', name: 'router', description: 'URL → component' },
      {
        id: 'angular/forms',
        name: 'forms',
        description: 'Reactive + template forms',
      },
      {
        id: 'angular/animations',
        name: 'animations',
        description: 'Web animations API',
      },
      { id: 'angular/cdk', name: 'cdk', description: 'Component dev kit' },
      {
        id: 'angular/material',
        name: 'material',
        description: 'MDC components',
      },
    ],
  },
  {
    id: 'gradii',
    name: '@gradii',
    packages: [
      {
        id: 'gradii/treeview',
        name: 'gradii-angular-treeview',
        description: 'Hierarchical tree',
      },
      {
        id: 'gradii/xxx',
        name: 'gradii-angular-xxx',
        description: 'Tabular data',
      },
      {
        id: 'gradii/yyy',
        name: 'gradii-angular-yyy',
        description: 'Text, number, date',
      },
      {
        id: 'gradii/zzz',
        name: 'gradii-angular-zzz',
        description: 'Select, multiselect',
      },
      {
        id: 'gradii/aaa',
        name: 'gradii-angular-aaa',
        description: 'Button, toggle, split',
      },
      {
        id: 'gradii/bbb',
        name: 'gradii-angular-bbb',
        description: 'SVG icon set',
      },
    ],
  },
  {
    id: 'rx',
    name: 'rxjs',
    packages: [
      {
        id: 'rx/operators',
        name: 'operators',
        description: 'map, filter, switchMap, …',
      },
      { id: 'rx/ajax', name: 'ajax', description: 'XHR observables' },
      {
        id: 'rx/webSocket',
        name: 'webSocket',
        description: 'WebSocket observables',
      },
      { id: 'rx/testing', name: 'testing', description: 'Marble testing' },
    ],
  },
  {
    id: 'tooling',
    name: 'tooling',
    packages: [
      {
        id: 'tooling/typescript',
        name: 'typescript',
        description: 'Static types',
      },
      { id: 'tooling/eslint', name: 'eslint', description: 'Linter' },
      { id: 'tooling/prettier', name: 'prettier', description: 'Formatter' },
      { id: 'tooling/vitest', name: 'vitest', description: 'Unit testing' },
      {
        id: 'tooling/playwright',
        name: 'playwright',
        description: 'E2E testing',
      },
      { id: 'tooling/nx', name: 'nx', description: 'Monorepo orchestrator' },
      { id: 'tooling/vite', name: 'vite', description: 'Bundler / dev server' },
      { id: 'tooling/webpack', name: 'webpack', description: 'Bundler' },
    ],
  },
  {
    id: 'misc',
    name: 'utility belts',
    packages: [
      { id: 'misc/lodash', name: 'lodash', description: 'Functional utils' },
      { id: 'misc/date-fns', name: 'date-fns', description: 'Date utils' },
      { id: 'misc/immer', name: 'immer', description: 'Immutable updates' },
      { id: 'misc/zod', name: 'zod', description: 'Runtime schema' },
      { id: 'misc/yup', name: 'yup', description: 'Schema validation' },
      { id: 'misc/uuid', name: 'uuid', description: 'UUID generation' },
    ],
  },
];

@Component({
  selector: 'app-demo-treeview-5',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-5.html',
  styleUrl: './demo-treeview-5.css',
})
export class DemoTreeview5 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy<Pkg>(NPM, {
      childrenField: 'packages',
      textField: 'name',
      idField: 'id',
      blockSize: 0,
      rootLabel: 'npm — pretend registry',
    }),
  );

  readonly term = signal('');
  readonly mode = signal<FilterMode>('lenient');
  readonly operator = signal<FilterOperator>('contains');
  readonly ignoreCase = signal(true);

  readonly settings = computed(() => ({
    mode: this.mode(),
    operator: this.operator(),
    ignoreCase: this.ignoreCase(),
  }));

  readonly modes: ReadonlyArray<FilterMode> = ['lenient', 'strict'];
  readonly operators: ReadonlyArray<
    Exclude<FilterOperator, (...args: unknown[]) => unknown>
  > = ['contains', 'startswith', 'endswith', 'equals'];

  setTerm(value: string): void {
    this.term.set(value);
  }

  setMode(m: FilterMode): void {
    this.mode.set(m);
  }

  setOperator(op: FilterOperator): void {
    this.operator.set(op);
  }

  toggleCase(): void {
    this.ignoreCase.update((v) => !v);
  }

  clear(): void {
    this.term.set('');
  }
}
