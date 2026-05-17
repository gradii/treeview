import { TreeNode } from '../tree-model';

export type Key = string | number;

export type KeyFn<T extends TreeNode = TreeNode> = (node: T) => Key;

export const defaultKeyFn: KeyFn = (node) => node.id;

export function keyOf(node: TreeNode, keyFn?: KeyFn): Key {
  return (keyFn ?? defaultKeyFn)(node);
}
