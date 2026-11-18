import fs from 'node:fs';
import path from 'node:path';
import { GitRepo } from './git.mjs';
import { parseUnifiedDiff, extractTodosFromAddedLines } from './diff-parse.mjs';
import { createResolver, languageOf, scanRepository } from './deps.mjs';
import { loadLanguageSpecs, registryFor } from './languages.mjs';
import {
  clampText,
  formatTimestamp,
  isProbablyBinary,
  naturalCompare,
  readJsonSafe,
  shortId,
  toPosix,
  uniqueBy,
} from './util.mjs';

const MAX_CONTENT_CHARS = 400_000;
const MAX_PATCH_CHARS = 300_000;
const MAX_UNTRACKED = 200;

function quotePathForDiff(filePath) {
  return filePath;
}

function buildUntrackedPatch(filePath, content) {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const header = `diff --git a/${quotePathForDiff(filePath)} b/${quotePathForDiff(filePath)}\nnew file mode 100644\n--- /dev/null\n+++ b/${quotePathForDiff(filePath)}`;
  if (lines.length === 0) return header;
  const body = lines.map((line) => `+${line}`).join('\n');
  return `${header}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

function diffArgs(extra = []) {
  return [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--unified=5',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    ...extra,
  ];
}

export function resolveScope(repo, options = {}) {
  const head = repo.head;
  const emptyTree = repo.emptyTree;
  const headRef = head || null;

  const runRevDiff = (baseRef, newRef, label) => ({
    mode: 'rev',
    baseRef,
    newRef,
    headRef,
    args: diffArgs([baseRef, newRef, '--']),
    label,
    includeUntracked: false,
  });

  const worktreeScope = () => ({
    mode: 'worktree',
    baseRef: head || emptyTree,
    newRef: 'WORKTREE',
    headRef,
    args: diffArgs([head || emptyTree, '--']),
    label: head ? `工作区 · ${head.slice(0, 8)}` : '工作区 · 初始提交',
    includeUntracked: options.untracked !== false,
  });

  if (options.staged) {
    if (!head) {
      return {
        mode: 'staged',
        baseRef: emptyTree,
        newRef: 'INDEX',
        headRef: null,
        args: diffArgs(['--cached', '--']),
        label: '暂存区（初始提交）',
        includeUntracked: false,
      };
    }
    return {
      mode: 'staged',
      baseRef: head,
      newRef: 'INDEX',
      headRef: head,
      args: diffArgs(['--cached', head, '--']),
      label: `暂存区 · ${head.slice(0, 8)}`,
      includeUntracked: false,
    };
  }

  if (options.commit) {
    const target = repo.revParse(options.commit);
    if (!target) throw new Error(`无法解析提交：${options.commit}`);
    const parent = repo.revParse(`${options.commit}~1`) || emptyTree;
    return runRevDiff(parent, target, `提交 ${target.slice(0, 8)}`);
  }

  if (options.last) {
    const parent = head ? repo.revParse('HEAD~1') : null;
    const baseRef = parent || emptyTree;
    if (!head) throw new Error('当前仓库还没有提交，无法查看最近一次提交。');
    return runRevDiff(baseRef, head, parent ? `最近提交 · ${head.slice(0, 8)}` : `首个提交 · ${head.slice(0, 8)}`);
  }

  if (options.range) {
    const range = String(options.range).trim();
    let baseRef;
    let targetRef;
    let display;
    if (range.includes('...')) {
      const [from, to] = range.split('...');
      const target = to || 'HEAD';
      targetRef = repo.revParse(target);
      if (!targetRef) throw new Error(`无法解析提交范围：${range}`);
      baseRef = repo.mergeBase(from, targetRef);
      if (!baseRef) throw new Error(`找不到 ${from} 与 ${target} 的共同祖先。`);
      display = `${from}...${to || 'HEAD'}`;
    } else if (range.includes('..')) {
      const [from, to] = range.split('..');
      baseRef = repo.revParse(from);
      targetRef = repo.revParse(to || 'HEAD');
      if (!baseRef || !targetRef) throw new Error(`无法解析提交范围：${range}`);
      display = `${from}..${to || 'HEAD'}`;
    } else {
      baseRef = repo.revParse(range);
      targetRef = head;
      if (!baseRef || !targetRef) throw new Error(`无法解析提交范围：${range}`);
      display = `${range}..HEAD`;
    }
    return runRevDiff(baseRef, targetRef, `${display} (${String(range).slice(0, 48)})`);
  }

  if (options.base) {
    if (!head) throw new Error('当前仓库还没有提交，无法与目标分支比较。');
    const baseRef = repo.mergeBase(options.base, head);
    if (!baseRef) throw new Error(`无法找到 ${options.base} 与 HEAD 的共同祖先。`);
    return runRevDiff(baseRef, head, `${options.base}...HEAD`);
  }

  if (options.worktree) return worktreeScope();

  const useLast = options.last === undefined && options.autoLast !== false && head && !repo.isDirty();
  if (useLast && repo.revParse('HEAD~1')) {
    return runRevDiff(repo.revParse('HEAD~1'), head, `最近提交 · ${head.slice(0, 8)}`);
  }
  if (useLast && head) {
    return runRevDiff(emptyTree, head, `首个提交 · ${head.slice(0, 8)}`);
  }

  return worktreeScope();
}

function getWorktreeContent(repo, filePath) {
  try {
    const abs = path.join(repo.root, filePath);
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_CONTENT_CHARS * 4) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function readContent(repo, scope, filePath, side, prefetched = null) {
  if (!filePath) return null;
  if (prefetched) {
    const ref = side === 'new' ? scope.newRef : scope.baseRef;
    if (ref) {
      const key = `${ref}\u0000${filePath}`;
      if (prefetched.has(key)) return prefetched.get(key);
    }
  }
  if (side === 'new') {
    if (scope.mode === 'WORKTREE' || scope.mode === 'worktree') return getWorktreeContent(repo, filePath);
    if (scope.mode === 'staged') return repo.showIndex(filePath);
    return repo.show(scope.newRef, filePath);
  }
  if (!scope.baseRef) return null;
  return repo.show(scope.baseRef, filePath);
}

// Changed-file contents at a revision are read in two batch calls (base ref and
// target ref) instead of two `git show` processes per changed file.
function prefetchRevContents(repo, scope, files) {
  if (scope.mode !== 'rev') return null;
  const jobs = new Map();
  const add = (ref, filePath) => {
    if (!ref || !filePath) return;
    if (!jobs.has(ref)) jobs.set(ref, new Set());
    jobs.get(ref).add(filePath);
  };
  for (const file of files) {
    const oldPath = file.oldPath || file.path;
    if (file.status !== 'added') add(scope.baseRef, oldPath);
    if (file.status !== 'deleted') add(scope.newRef, file.path);
  }
  const contents = new Map();
  for (const [ref, paths] of jobs) {
    const read = repo.readFilesAt(ref, [...paths]);
    for (const [filePath, buffer] of read) contents.set(`${ref}\u0000${filePath}`, buffer);
  }
  return contents;
}

function addedLineCount(content) {
  if (!content) return 0;
  if (content === '') return 0;
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

function loadFileContents(repo, scope, file, prefetched = null) {
  const oldPath = file.oldPath || file.path;
  const newPath = file.path;
  let oldBuffer = null;
  let newBuffer = null;

  if (file.status !== 'added') oldBuffer = readContent(repo, scope, oldPath, 'old', prefetched);
  if (file.status !== 'deleted') newBuffer = readContent(repo, scope, newPath, 'new', prefetched);

  const binary =
    Boolean(file.binary) ||
    (oldBuffer ? isProbablyBinary(oldBuffer) : false) ||
    (newBuffer ? isProbablyBinary(newBuffer) : false);

  if (binary) {
    return { binary: true, oldContent: '', newContent: '', contentTruncated: false };
  }

  const oldRaw = oldBuffer ? oldBuffer.toString('utf8') : '';
  const newRaw = newBuffer ? newBuffer.toString('utf8') : '';
  const oldClamped = clampText(oldRaw, MAX_CONTENT_CHARS);
  const newClamped = clampText(newRaw, MAX_CONTENT_CHARS);
  return {
    binary: false,
    oldContent: oldClamped.text,
    newContent: newClamped.text,
    contentTruncated: oldClamped.truncated || newClamped.truncated,
  };
}

function heuristicSummary(node) {
  const sections = uniqueBy(
    (node._hunks || []).map((hunk) => hunk.section).filter(Boolean),
    (value) => value,
  ).slice(0, 3);
  if (node.status === 'added') {
    const lines = addedLineCount(node.newContent);
    return `新增文件，共 ${lines} 行代码${sections.length ? `；起始于 ${sections.join('、')}` : ''}。`;
  }
  if (node.status === 'deleted') {
    const lines = addedLineCount(node.oldContent);
    return `删除文件，移除 ${lines} 行代码。`;
  }
  const hunkCount = (node._hunks || []).length;
  const parts = [`${hunkCount || 1} 个代码区块，+${node.stats.additions} / −${node.stats.deletions} 行`];
  if (sections.length) parts.push(`涉及 ${sections.join('、')}`);
  return `修改了 ${parts.join('，')}。`;
}

function heuristicImpact(node, details = {}) {
  if (node.status === 'impacted_only') {
    const origins = node.impactOrigins || [];
    if (origins.length) {
      return `该文件未改动，但直接依赖 ${origins.slice(0, 3).map((id) => `「${id}」`).join('、')}${origins.length > 3 ? ' 等' : ''} 的变更，需要回归验证。`;
    }
    return '该文件未改动，因依赖链被纳入检查范围。';
  }
  const direct = details.direct || [];
  const changedDirect = details.changedDirect || [];
  const deeper = details.deeper || 0;
  if (direct.length === 0 && changedDirect.length === 0 && deeper === 0) {
    return '未发现仓库内依赖该文件的下游模块，影响范围预计局限在本文件。';
  }
  const list = direct
    .slice(0, 4)
    .map((id) => `「${id}」`)
    .join('、');
  let text = direct.length
    ? `直接影响 ${direct.length} 个下游文件${list ? `（${list}${direct.length > 4 ? ' 等' : ''}）` : ''}。`
    : '';
  if (changedDirect.length > 0) {
    const changedList = changedDirect
      .slice(0, 4)
      .map((id) => `「${id}」`)
      .join('、');
    text += `${direct.length ? '另有' : '下游'} ${changedDirect.length} 个文件也在本次变更中${changedList ? `（${changedList}${changedDirect.length > 4 ? ' 等' : ''}）` : ''}。`;
  }
  if (deeper > 0) text += `还有 ${deeper} 个文件通过依赖链间接受影响。`;
  text += direct.length ? '未改动的下游文件建议按依赖顺序回归验证。' : '可结合依赖关系确认调用方是否需要同步调整。';
  return text;
}

function impactDetailsFor(paths, changedIds, dependents, depthLimit) {
  const direct = new Set();
  const changedDirect = new Set();
  const seen = new Set();
  const queue = [];
  for (const dependent of dependents.get(paths) || []) {
    if (changedIds.has(dependent)) {
      changedDirect.add(dependent);
      continue;
    }
    if (!direct.has(dependent)) {
      direct.add(dependent);
      seen.add(dependent);
      queue.push({ path: dependent, depth: 1 });
    }
  }
  const deeper = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= depthLimit) continue;
    for (const dependent of dependents.get(current.path) || []) {
      if (changedIds.has(dependent) || seen.has(dependent)) continue;
      seen.add(dependent);
      deeper.add(dependent);
      queue.push({ path: dependent, depth: current.depth + 1 });
    }
  }
  return {
    direct: [...direct].sort(naturalCompare),
    changedDirect: [...changedDirect].sort(naturalCompare),
    deeper: deeper.size,
  };
}

function buildOverallSummary(changed, impacted, todos) {
  if (changed.length === 0) return '当前范围没有检测到代码变更。';
  const additions = changed.reduce((sum, node) => sum + node.stats.additions, 0);
  const deletions = changed.reduce((sum, node) => sum + node.stats.deletions, 0);
  const statusCount = changed.reduce((acc, node) => {
    acc[node.status] = (acc[node.status] || 0) + 1;
    return acc;
  }, {});
  const bits = [];
  if (statusCount.added) bits.push(`新增 ${statusCount.added}`);
  if (statusCount.modified) bits.push(`修改 ${statusCount.modified}`);
  if (statusCount.deleted) bits.push(`删除 ${statusCount.deleted}`);
  return `本次变更涉及 ${changed.length} 个文件（${bits.join(' / ')}，+${additions} / −${deletions}），依赖分析发现 ${impacted.length} 个受影响的下游文件${todos.length ? `，附带 ${todos.length} 个待确认项` : ''}。`;
}

const ALWAYS_EXCLUDED = new Set([
  '.diff-review-data.json',
  '.diff-review-annotations.json',
  '.diff-review.log',
]);

function synthesizeUntrackedSections(repo, scope, options = {}) {
  const files = [];
  const warnings = [];
  if (!scope.includeUntracked) return { files, warnings };
  const excluded = new Set(ALWAYS_EXCLUDED);
  const excludedPrefixes = [];
  for (const excludePath of options.excludePaths ?? []) {
    if (!excludePath) continue;
    const relative = path.relative(repo.root, excludePath);
    if (relative && !relative.startsWith('..')) {
      const posix = toPosix(relative);
      excluded.add(posix);
      // Split review storage keeps hundreds of node payload files in a sibling
      // directory; they must never show up as untracked source files.
      excludedPrefixes.push(`${posix}/`);
    }
  }
  let candidates = repo.listUntracked().map(toPosix).filter((filePath) => {
    if (excluded.has(filePath)) return false;
    if (excludedPrefixes.some((prefix) => filePath.startsWith(prefix))) return false;
    if (filePath.startsWith('.diff-review/')) return false;
    return true;
  });
  if (candidates.length > MAX_UNTRACKED) {
    warnings.push(`仅展示前 ${MAX_UNTRACKED} 个未跟踪文件（共 ${candidates.length} 个）。`);
    candidates = candidates.slice(0, MAX_UNTRACKED);
  }
  for (const filePath of candidates) {
    const buffer = getWorktreeContent(repo, filePath);
    if (!buffer) {
      warnings.push(`未跟踪文件过大，已跳过：${filePath}`);
      continue;
    }
    if (isProbablyBinary(buffer)) continue;
    const content = buffer.toString('utf8');
    const patch = buildUntrackedPatch(filePath, content);
    const parsed = parseUnifiedDiff(patch);
    if (parsed.files.length === 0) continue;
    parsed.files[0].untracked = true;
    files.push(parsed.files[0]);
  }
  return { files, warnings };
}

export function collectChangeSet(repo, options = {}) {
  const scope = resolveScope(repo, options);
  const diffResult = repo.run(scope.args);
  const parsed = parseUnifiedDiff(diffResult.stdout);
  const warnings = [];

  if (scope.includeUntracked) {
    const untracked = synthesizeUntrackedSections(repo, scope, options);
    parsed.files.push(...untracked.files);
    warnings.push(...untracked.warnings);
  }

  return { scope, files: parsed.files, warnings };
}

// Extra languages come from --languages <file>, or from the project's own
// .diff-viz/languages.json. A broken config fails loudly instead of silently
// dropping dependency edges.
function loadRegistry(root, option) {
  const configured = Array.isArray(option) ? option : null;
  if (configured) return registryFor(configured);
  const explicit = Boolean(option);
  const file = explicit
    ? path.resolve(process.cwd(), String(option))
    : path.join(root, '.diff-viz', 'languages.json');
  if (!fs.existsSync(file)) {
    if (explicit) throw new Error(`语言配置不存在：${file}`);
    return registryFor([]);
  }
  try {
    return registryFor(loadLanguageSpecs(file));
  } catch (error) {
    throw new Error(`语言配置读取失败（${file}）：${error.message}`);
  }
}

export function buildReviewData(repo, options = {}) {
  const startedAt = Date.now();
  const { scope, files: parsedFiles, warnings } = collectChangeSet(repo, options);
  const changedFiles = [];
  const seenPaths = new Set();
  const prefetchedContents = prefetchRevContents(repo, scope, parsedFiles);

  for (const file of parsedFiles) {
    if (!file.path || seenPaths.has(file.path)) continue;
    seenPaths.add(file.path);
    const contents = loadFileContents(repo, scope, file, prefetchedContents);
    const patch = clampText(file.patch, MAX_PATCH_CHARS);
    const node = {
      id: file.path,
      label: path.posix.basename(file.path),
      path: file.path,
      status: file.status,
      stats: { additions: file.additions, deletions: file.deletions },
      summary: '',
      impactAnalysis: '',
      todos: extractTodosFromAddedLines(file.path, file.addedLines),
      diff: patch.text,
      diffTruncated: patch.truncated || Boolean(file.diffTruncated),
      language: languageOf(file.path),
      oldContent: contents.oldContent,
      newContent: contents.newContent,
      binary: contents.binary,
      contentTruncated: contents.contentTruncated,
      _hunks: file.hunks,
    };
    if (file.oldPath && file.oldPath !== file.path) node.oldPath = file.oldPath;
    if (file.renamed) node.renamed = true;
    if (file.untracked) node.untracked = true;
    if (contents.binary) node.diff = '';
    changedFiles.push(node);
  }

  const scanRef = options.scanRef ?? (scope.mode === 'rev' ? scope.newRef : null);
  const registry = loadRegistry(repo.root, options.languages);
  const scan = scanRepository(repo, {
    includeUntracked: !scanRef && options.untracked !== false,
    maxFiles: options.maxScanFiles ?? 15000,
    gitRef: scanRef,
    registry,
  });
  warnings.push(...scan.warnings);

  const fileSet = new Set(scan.files.keys());
  for (const node of changedFiles) {
    fileSet.add(node.path);
    if (node.oldPath) fileSet.add(node.oldPath);
  }
  for (const file of parsedFiles) {
    if (file.oldPath) fileSet.add(file.oldPath);
  }

  const oldPathAliases = new Map();
  for (const node of changedFiles) {
    if (node.oldPath) oldPathAliases.set(node.oldPath, node.path);
  }

  const resolver = createResolver({
    root: repo.root,
    fileSet,
    tsconfig: scan.tsconfig,
    goModule: scan.goModule,
    workspacePackages: scan.workspacePackages,
    javaIndex: scan.javaIndex,
    oldPathAliases,
    registry,
    packageIndexes: scan.packageIndexes,
  });

  const resolvedImports = new Map();
  const dependents = new Map();
  for (const [filePath, entry] of scan.files) {
    const targets = new Set();
    for (const imp of entry.imports) {
      for (const target of resolver.resolve(filePath, imp)) {
        if (target && target !== filePath) targets.add(target);
      }
    }
    for (const target of entry.javaSamePackageTargets || []) {
      if (target && target !== filePath) targets.add(target);
    }
    resolvedImports.set(filePath, targets);
    for (const target of targets) {
      if (!dependents.has(target)) dependents.set(target, new Set());
      dependents.get(target).add(filePath);
    }
  }

  const changedIds = new Set(changedFiles.map((node) => node.path));
  const impactDepth = Math.max(1, Math.min(Number(options.impactDepth) || 3, 6));
  const maxImpact = Math.max(1, Math.min(Number(options.maxImpact) || 120, 500));
  const impacted = [];
  const impactedDepths = new Map();
  const impactOrigins = new Map();
  const impactParent = new Map();
  const queue = [];
  for (const node of changedFiles) {
    impactedDepths.set(node.path, 0);
    for (const dependent of dependents.get(node.path) || []) {
      if (changedIds.has(dependent)) continue;
      if (!impactedDepths.has(dependent)) {
        impactedDepths.set(dependent, 1);
        impactOrigins.set(dependent, new Set([node.path]));
        impactParent.set(dependent, node.path);
        queue.push({ path: dependent, depth: 1 });
      } else {
        impactOrigins.get(dependent)?.add(node.path);
      }
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= impactDepth) continue;
    for (const dependent of dependents.get(current.path) || []) {
      if (changedIds.has(dependent) || impactedDepths.has(dependent)) continue;
      impactedDepths.set(dependent, current.depth + 1);
      impactOrigins.set(dependent, new Set(impactOrigins.get(current.path) || []));
      impactParent.set(dependent, current.path);
      queue.push({ path: dependent, depth: current.depth + 1 });
      if (queue.length > maxImpact * 6) break;
    }
    if (queue.length > maxImpact * 6) break;
  }

  const impactedList = [...impactedDepths.entries()]
    .filter(([id, depth]) => depth > 0 && !changedIds.has(id))
    .sort((a, b) => a[1] - b[1] || naturalCompare(a[0], b[0]));
  if (impactedList.length > maxImpact) {
    warnings.push(`影响面过大，仅展示 ${maxImpact} 个下游文件（共 ${impactedList.length} 个）。`);
  }

  const chainFor = (id) => {
    const chain = [];
    const seen = new Set();
    let current = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.unshift(current);
      current = impactParent.get(current);
    }
    return chain;
  };

  for (const [id, depth] of impactedList.slice(0, maxImpact)) {
    impacted.push({
      id,
      label: path.posix.basename(id),
      path: id,
      status: 'impacted_only',
      stats: { additions: 0, deletions: 0 },
      summary: '',
      impactAnalysis: '',
      todos: [],
      diff: '',
      oldContent: '',
      newContent: '',
      language: languageOf(id),
      depth,
      impactOrigins: [...(impactOrigins.get(id) || [])].sort(naturalCompare),
      impactChain: chainFor(id),
    });
  }

  const includedIds = new Set([...changedIds, ...impacted.map((node) => node.path)]);
  const edges = [];
  for (const node of [...changedFiles, ...impacted]) {
    for (const target of resolvedImports.get(node.path) || []) {
      if (!includedIds.has(target) || target === node.path) continue;
      edges.push({ id: `e-${shortId(`${node.path}->${target}`, 12)}`, source: node.path, target, relation: 'imports' });
    }
  }
  const finalNodes = [...changedFiles, ...impacted];
  const totalTodos = finalNodes.reduce((sum, node) => sum + node.todos.length, 0);

  // Keep the complete dependency lists on each node. Edges only describe
  // relationships inside the visible subgraph; the drawer should still show
  // upstream modules that were intentionally left out of the graph.
  for (const node of finalNodes) {
    node.imports = [...(resolvedImports.get(node.path) || [])].sort(naturalCompare);
    node.importedBy = [...(dependents.get(node.path) || [])].sort(naturalCompare);
  }

  for (const node of impacted) {
    node.impactAnalysis = heuristicImpact(node);
  }
  for (const node of changedFiles) {
    node.summary = heuristicSummary(node);
    node.impactAnalysis = heuristicImpact(
      node,
      impactDetailsFor(node.path, changedIds, dependents, impactDepth),
    );
    node.summarySource = 'auto';
    delete node._hunks;
  }

  const reviewOrder = computeReviewOrder(changedFiles, edges);
  const dedupedEdges = uniqueBy(edges, (edge) => `${edge.source}->${edge.target}`).sort(
    (a, b) => naturalCompare(a.source, b.source) || naturalCompare(a.target, b.target),
  );
  if (dedupedEdges.length === 0 && changedFiles.length > 1) {
    warnings.push(
      '未解析到文件之间的依赖边；如果项目使用路径别名、跨包引用或动态加载，可能未被静态解析覆盖。',
    );
  }

  const meta = {
    timestamp: formatTimestamp(),
    branch: repo.branchName(),
    overallSummary: options.summary?.trim() || buildOverallSummary(changedFiles, impacted, finalNodes.flatMap((node) => node.todos)),
    mode: scope.mode,
    rangeLabel: scope.label,
    baseRef: scope.baseRef,
    newRef: scope.newRef,
    headRef: scope.headRef || null,
    impactDepth,
    repo: path.basename(repo.root),
    scannedRef: scanRef,
    generator: 'diff-viz',
    version: options.version || '0.1.0',
    reviewOrder,
    stats: {
      changedFiles: changedFiles.length,
      impactedFiles: impacted.length,
      additions: changedFiles.reduce((sum, node) => sum + node.stats.additions, 0),
      deletions: changedFiles.reduce((sum, node) => sum + node.stats.deletions, 0),
      todos: totalTodos,
      edges: dedupedEdges.length,
      scannedFiles: scan.stats.scannedFiles,
    },
    warnings: [...new Set(warnings)],
    durationMs: Date.now() - startedAt,
  };

  const data = { meta, nodes: finalNodes, edges: dedupedEdges };

  const annotations =
    options.annotations ?? (options.annotationFile ? readJsonSafe(options.annotationFile) : null);
  if (options.annotationFile && !annotations) {
    warnings.push(`无法读取注解文件：${options.annotationFile}`);
    meta.warnings = [...new Set(warnings)];
  } else if (annotations) {
    applyAnnotations(data, annotations);
    meta.warnings = [...new Set(warnings)];
  }

  return data;
}

function computeReviewOrder(changed, edges) {
  const changedIds = new Set(changed.map((node) => node.path));
  const dependencies = new Map();
  for (const node of changed) dependencies.set(node.path, []);
  for (const edge of edges) {
    if (!changedIds.has(edge.source) || !changedIds.has(edge.target)) continue;
    dependencies.get(edge.source).push(edge.target);
  }
  const state = new Map();
  const order = [];
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return; // cycle: break it
    state.set(id, 1);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    state.set(id, 2);
    order.push(id);
  };
  for (const node of [...changed].sort((a, b) => naturalCompare(a.path, b.path))) visit(node.path);
  return order;
}

/* ------------------------------------------------------------------ */
/* annotations                                                         */
/* ------------------------------------------------------------------ */

function normalizeTodo(raw, nodePath, index) {
  if (typeof raw === 'string') {
    return {
      id: `a-${shortId(`${nodePath}::${raw}`, 10)}`,
      text: raw,
      source: 'agent',
      completed: false,
    };
  }
  if (!raw || typeof raw !== 'object' || !raw.text) return null;
  const text = String(raw.text);
  return {
    id: raw.id ? String(raw.id) : `a-${shortId(`${nodePath}::${text}`, 10)}`,
    text,
    source: raw.source ? String(raw.source) : 'agent',
    completed: Boolean(raw.completed),
    severity: raw.severity ? String(raw.severity) : undefined,
    category: raw.category ? String(raw.category) : undefined,
    line: Number.isFinite(raw.line) ? raw.line : undefined,
  };
}

export function applyAnnotations(data, annotations, { onlyPaths = null } = {}) {
  if (!annotations || typeof annotations !== 'object') return data;
  const allowed = onlyPaths && onlyPaths.length ? new Set(onlyPaths) : null;
  const meta = annotations.meta ?? {};
  if (annotations.overallSummary || meta.overallSummary) {
    data.meta.overallSummary = String(annotations.overallSummary || meta.overallSummary);
    data.meta.summarySource = 'agent';
  }
  if (annotations.branch) data.meta.branch = String(annotations.branch);
  const entries = [];
  const rawNodes = annotations.nodes;
  if (Array.isArray(rawNodes)) {
    for (const item of rawNodes) entries.push([item.path || item.id, item]);
  } else if (rawNodes && typeof rawNodes === 'object') {
    for (const [key, item] of Object.entries(rawNodes)) entries.push([item.path || item.id || key, item]);
  }
  const byId = new Map(data.nodes.map((node) => [node.path, node]));

  for (const [key, annotation] of entries) {
    const node = byId.get(key);
    if (!node) continue;
    if (allowed && !allowed.has(key)) continue;
    if (typeof annotation.summary === 'string') {
      node.summary = annotation.summary;
      node.summarySource = 'agent';
    }
    if (typeof annotation.impactAnalysis === 'string') {
      node.impactAnalysis = annotation.impactAnalysis;
      node.impactSource = 'agent';
    }
    if (Array.isArray(annotation.todos)) {
      const existingTexts = new Set(node.todos.map((todo) => todo.text));
      annotation.todos.forEach((raw, index) => {
        const todo = normalizeTodo(raw, node.path, index);
        if (!todo || existingTexts.has(todo.text)) return;
        if (node.todos.some((item) => item.id === todo.id)) {
          todo.id = `${todo.id}-${index}`;
        }
        node.todos.push(todo);
        existingTexts.add(todo.text);
      });
    }
    if (annotation.reviewed === true) node.reviewed = true;
    if (Array.isArray(annotation.notes)) {
      node.reviewNotes = annotation.notes.map(String);
    }
  }
  data.meta.annotatedAt = formatTimestamp();
  return data;
}

/* ------------------------------------------------------------------ */
/* state preservation                                                  */
/* ------------------------------------------------------------------ */

export function mergePreviousState(data, previous) {
  if (!previous || !Array.isArray(previous.nodes)) return data;
  const priorById = new Map(previous.nodes.map((node) => [node.id || node.path, node]));
  for (const node of data.nodes) {
    const prior = priorById.get(node.path);
    if (!prior) continue;
    if (prior.reviewed) node.reviewed = true;
    const priorTodos = Array.isArray(prior.todos) ? prior.todos : [];
    const completedById = new Map();
    const completedByText = new Map();
    for (const todo of priorTodos) {
      if (todo.completed) {
        if (todo.id) completedById.set(todo.id, true);
        if (todo.text) completedByText.set(todo.text, true);
      }
    }
    for (const todo of node.todos) {
      if (completedById.get(todo.id) || completedByText.get(todo.text)) todo.completed = true;
    }
    const existingTexts = new Set(node.todos.map((todo) => todo.text));
    for (const todo of priorTodos) {
      if (todo.source === 'manual' && !existingTexts.has(todo.text)) {
        node.todos.push({ ...todo });
        existingTexts.add(todo.text);
      }
    }
  }
  return data;
}
