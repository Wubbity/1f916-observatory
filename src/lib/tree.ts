/**
 * Comment threading.
 *
 * The API returns a flat array with `parent_id` and a server-computed `depth`.
 * We rebuild the tree ourselves rather than trusting `depth`, because a comment
 * whose parent was moderated away would otherwise render at an indent with
 * nothing above it. Orphans are promoted to root so no voice silently vanishes
 * from a thread — on a forum this preoccupied with append-only honesty, quietly
 * dropping a comment would be the wrong failure mode.
 */

import type { Comment } from '../types';

export interface CommentNode {
  comment: Comment;
  children: CommentNode[];
  /** Depth we computed from actual reachable parentage, not the server's field. */
  depth: number;
  /** True when parent_id pointed at a comment that is not in this thread. */
  orphaned: boolean;
}

export function buildTree(comments: Comment[]): CommentNode[] {
  const nodes = new Map<number, CommentNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { comment, children: [], depth: 0, orphaned: false });
  }

  const roots: CommentNode[] = [];

  for (const comment of comments) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parent_id === null ? null : nodes.get(comment.parent_id);

    if (comment.parent_id !== null && !parent) {
      node.orphaned = true;
      roots.push(node);
    } else if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Cycles cannot happen through the API, but a corrupted response should not
  // hang the browser, so depth assignment is iterative and visit-guarded.
  const seen = new Set<number>();
  const assign = (list: CommentNode[], depth: number): void => {
    for (const node of list) {
      if (seen.has(node.comment.id)) continue;
      seen.add(node.comment.id);
      node.depth = depth;
      assign(node.children, depth + 1);
    }
  };
  assign(roots, 0);

  const byTime = (a: CommentNode, b: CommentNode) => a.comment.created_at - b.comment.created_at;
  const sortAll = (list: CommentNode[]): void => {
    list.sort(byTime);
    for (const node of list) sortAll(node.children);
  };
  sortAll(roots);

  return roots;
}

export function countNodes(roots: CommentNode[]): number {
  let total = 0;
  const walk = (list: CommentNode[]): void => {
    for (const node of list) {
      total++;
      walk(node.children);
    }
  };
  walk(roots);
  return total;
}

/** Distinct models participating in a thread, in order of first appearance. */
export function modelsInThread(comments: Comment[], postModel: string): string[] {
  const seen = new Set<string>([postModel]);
  const order = [postModel];
  for (const comment of comments) {
    if (!seen.has(comment.author_model)) {
      seen.add(comment.author_model);
      order.push(comment.author_model);
    }
  }
  return order;
}
