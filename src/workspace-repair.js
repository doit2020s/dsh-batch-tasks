import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { attachWithHost } from './desktop-bridge.js';
import { warmListingCache } from './listing-cache.js';

const targetLocks = new WeakMap();

function sessionId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\0/\\]/.test(value)) {
    throw new Error(`${label}会话 ID 无效`);
  }
  return value;
}

async function canonicalDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value)) {
    throw new Error(`${label}必须是绝对目录`);
  }
  // The official registry performs the directory check again at attachment.
  return realpath(value);
}

async function snapshot(persistence, id) {
  const handle = await persistence.open(id, 'read');
  try {
    const value = await handle.read();
    if (!Array.isArray(value?.events)) throw new Error('DSH 会话历史接口返回了无效事件列表');
    return { header: handle.header, events: value.events, inheritedEventCount: handle.inheritedEventCount };
  } finally {
    await handle.close();
  }
}

function validateCompleted(events) {
  for (const [index, event] of events.entries()) {
    if (event?.seq !== index) throw new Error('源会话历史不连续，无法安全恢复');
  }
  const boundary = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end');
  if (boundary?.type !== 'turn/end' || boundary.data?.reason?.kind !== 'completed') {
    throw new Error('只可恢复已经完成的批量会话；源会话没有完成的 turn/end');
  }
}

async function validateExisting(existing, source, { sourceId, targetId, cwd }) {
  const header = existing.header;
  if (header?.id !== targetId || header.parentSession !== sourceId || header.isSeeded !== false
    || header.agentPreset !== source.header.agentPreset || await canonicalDirectory(header.cwd, '目标工作区') !== cwd) {
    throw new Error('目标会话已存在，但不属于此次批量历史恢复');
  }
  // A successfully attached copy may subsequently have been continued by the
  // user. Preserve that suffix; only the copied prefix belongs to repair.
  if (existing.inheritedEventCount !== 0 || existing.events.length < source.events.length
    || source.events.some((event, index) => JSON.stringify(event) !== JSON.stringify(existing.events[index]))) {
    throw new Error('目标会话历史与源会话不一致，保留两份日志并停止恢复');
  }
}

async function copyAndAttach(ctx, input) {
  const { sourceId, targetId, title, sourceWorkDir } = input;
  const cwd = await canonicalDirectory(input.cwd, '批次工作区');
  const expectedSourceDir = await canonicalDirectory(sourceWorkDir, '原任务工作目录');
  const persistence = ctx.sessionPersistence;
  const source = await snapshot(persistence, sourceId);
  if (source.header?.id !== sourceId || await canonicalDirectory(source.header.cwd, '源会话工作目录') !== expectedSourceDir) {
    throw new Error('源会话工作目录不属于该批量任务，无法恢复');
  }
  validateCompleted(source.events);

  let existing;
  try { existing = await snapshot(persistence, targetId); }
  catch (error) { if (error?.name !== 'SessionPersistenceNotFoundError') throw error; }
  let copied = false;
  let target;
  if (!existing) {
    // The source header is immutable. Full-history relocation preserves its
    // log as own events; parentSession records provenance without fork cuts.
    const header = { ...source.header, id: targetId, cwd, parentSession: sourceId, isSeeded: false };
    let writer;
    try {
      writer = await persistence.create(header, { inheritedEventCount: 0 });
    } catch (error) {
      if (error?.name !== 'SessionAlreadyExistsError') throw error;
      existing = await snapshot(persistence, targetId);
    }
    if (writer) {
      try {
        await writer.append(source.events);
        await writer.flush();
      } finally {
        await writer.close();
      }
      copied = true;
      target = { header, events: source.events, inheritedEventCount: 0 };
    }
  }
  if (existing) {
    await validateExisting(existing, source, { sourceId, targetId, cwd });
    target = existing;
  }
  await warmListingCache(ctx, target.header, 0, target.events);
  const attachment = await attachWithHost(ctx, { cwd, sessionId: targetId, title });
  // Archival is a separate caller decision, after the queue owns this result.
  // Never delete or alter the source log or workspace registration here.
  return { ...attachment, sourceId, sourceWorkDir: expectedSourceDir, copied };
}

/** Copy a completed batch session into its root workspace without running an Agent. */
export async function rehomeStoredSession(ctx, input = {}) {
  const persistence = ctx?.sessionPersistence;
  if (!persistence || typeof persistence.open !== 'function' || typeof persistence.create !== 'function') {
    throw new Error('DSH 会话持久化服务未就绪，不能恢复批量历史');
  }
  if (!ctx.workspaceRegistry || typeof ctx.workspaceRegistry.create !== 'function') {
    throw new Error('DSH 工作区服务未就绪，不能恢复批量历史');
  }
  if (typeof ctx.sessionProjections?.checkpoint !== 'function' || typeof ctx.storageDomain?.get !== 'function') {
    throw new Error('DSH 会话标题投影缓存服务未就绪，不能恢复批量历史');
  }
  const sourceId = sessionId(input.sourceId, '源');
  const targetId = sessionId(input.targetId, '目标');
  if (sourceId === targetId) throw new Error('恢复需要新的会话 ID，不能改写源会话');
  // Serialize retries for the same target while allowing unrelated task repairs.
  let locks = targetLocks.get(persistence);
  if (!locks) targetLocks.set(persistence, locks = new Map());
  const previous = locks.get(targetId) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => copyAndAttach(ctx, { ...input, sourceId, targetId }));
  locks.set(targetId, operation);
  try { return await operation; }
  finally { if (locks.get(targetId) === operation) locks.delete(targetId); }
}

/**
 * Retire a successfully replaced identity only AFTER the caller has saved its
 * durable queue pointer to the attached root copy. Archive retains the source
 * log; deleting a child registration retains its directory and all logs too.
 */
export async function retireOriginalSession(ctx, input = {}) {
  const sourceId = sessionId(input.sourceId, '源');
  const registry = ctx?.workspaceRegistry;
  if (!ctx?.sessionPersistence || typeof registry?.archiveSession !== 'function') {
    throw new Error('DSH 会话归档服务未就绪');
  }
  const cwd = await canonicalDirectory(input.cwd, '批次工作区');
  const sourceWorkDir = await canonicalDirectory(input.sourceWorkDir, '原任务工作目录');
  const source = await snapshot(ctx.sessionPersistence, sourceId);
  if (source.header?.id !== sourceId || await canonicalDirectory(source.header.cwd, '源会话工作目录') !== sourceWorkDir) {
    throw new Error('源会话工作目录不属于该批量任务，不能归档');
  }
  validateCompleted(source.events);
  await registry.archiveSession(sourceId);
  let removedWorkspaceId;
  if (sourceWorkDir !== cwd && typeof registry.resolveByPath === 'function' && typeof registry.delete === 'function') {
    const oldWorkspace = await registry.resolveByPath(sourceWorkDir);
    // Never remove the root or a record sharing another session. The official
    // getter reflects its current domain snapshot, including archived members.
    if (oldWorkspace && await canonicalDirectory(oldWorkspace.path, '原工作区') === sourceWorkDir
      && oldWorkspace.sessionIds.every(id => id === sourceId)) {
      if (await registry.delete(oldWorkspace.id)) removedWorkspaceId = String(oldWorkspace.id);
    }
  }
  return { sourceId, archived: true, removedWorkspaceId };
}
