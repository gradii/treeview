import { Route } from '@angular/router';
import { DemoCombined } from './demo-combined/demo-combined';
import { DemoTreeview1 } from './demo-treeview-1/demo-treeview-1';
import { DemoTreeview2 } from './demo-treeview-2/demo-treeview-2';
import { DemoTreeview3 } from './demo-treeview-3/demo-treeview-3';
import { DemoTreeview4 } from './demo-treeview-4/demo-treeview-4';
import { DemoTreeview5 } from './demo-treeview-5/demo-treeview-5';
import { DemoTreeview6 } from './demo-treeview-6/demo-treeview-6';
import { DemoTreeview7 } from './demo-treeview-7/demo-treeview-7';
import { DemoTreeview8 } from './demo-treeview-8/demo-treeview-8';
import { DemoTreeview9 } from './demo-treeview-9/demo-treeview-9';
import { DemoTreeview10 } from './demo-treeview-10/demo-treeview-10';
import { DemoTreeview11 } from './demo-treeview-11/demo-treeview-11';
import { DemoTreeview12 } from './demo-treeview-12/demo-treeview-12';
import { DemoTreeview13 } from './demo-treeview-13/demo-treeview-13';
import { DemoTreeview14 } from './demo-treeview-14/demo-treeview-14';

export const appRoutes: Route[] = [
  { path: '', component: DemoCombined, pathMatch: 'full' },
  { path: 'demo-1', component: DemoTreeview1 },
  { path: 'demo-2', component: DemoTreeview2 },
  { path: 'demo-3', component: DemoTreeview3 },
  { path: 'demo-4', component: DemoTreeview4 },
  { path: 'demo-5', component: DemoTreeview5 },
  { path: 'demo-6', component: DemoTreeview6 },
  { path: 'demo-7', component: DemoTreeview7 },
  { path: 'demo-8', component: DemoTreeview8 },
  { path: 'demo-9', component: DemoTreeview9 },
  { path: 'demo-10', component: DemoTreeview10 },
  { path: 'demo-11', component: DemoTreeview11 },
  { path: 'demo-12', component: DemoTreeview12 },
  { path: 'demo-13', component: DemoTreeview13 },
  { path: 'demo-14', component: DemoTreeview14 },
  { path: '**', redirectTo: '' },
];
