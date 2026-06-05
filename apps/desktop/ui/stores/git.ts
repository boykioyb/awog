import { defineStore } from 'pinia'
import { createGitContext } from './git/context'
import { createGitData } from './git/data'
import { createGitStaging } from './git/staging'
import { createGitSync } from './git/sync'
import { createGitBranches } from './git/branches'
import { createGitHistory } from './git/history'
import { createGitConflicts } from './git/conflicts'

// The git store is one bounded context split by concern across stores/git/* —
// this file only wires the shared reactive context to the per-domain action
// modules and re-exports the public surface. See:
//   - context.ts    shared state + getters + core helpers
//   - data.ts       read-side loaders (status/history/branches/…) + subscribe
//   - staging.ts    working-tree mutations + commit
//   - sync.ts       fetch / pull / push
//   - branches.ts   branch / stash / tag management
//   - history.ts    commit-level actions + diff loading
//   - conflicts.ts  conflict resolver + merge lifecycle
export const useGitStore = defineStore('git', () => {
  const ctx = createGitContext()
  const data = createGitData(ctx)
  const actionCtx = { ...ctx, ...data }
  const staging = createGitStaging(actionCtx)
  const sync = createGitSync(actionCtx)
  const branches = createGitBranches(actionCtx)
  const history = createGitHistory(actionCtx)
  const conflicts = createGitConflicts(actionCtx)

  return {
    // ─── state ───
    selectedProjectId: ctx.selectedProjectId,
    selectedFilePath: ctx.selectedFilePath,
    selectedCommitHash: ctx.selectedCommitHash,
    commitMessage: ctx.commitMessage,
    isFetching: ctx.isFetching,
    isPulling: ctx.isPulling,
    isPushing: ctx.isPushing,
    isGeneratingMessage: ctx.isGeneratingMessage,
    progressPct: ctx.progressPct,
    progressOp: ctx.progressOp,
    progressPhase: ctx.progressPhase,
    toasts: ctx.toasts,
    currentConflictFile: ctx.currentConflictFile,
    isMerging: ctx.isMerging,
    isDetached: ctx.isDetached,
    detachedAt: ctx.detachedAt,
    pendingCheckoutError: ctx.pendingCheckoutError,
    pendingDeleteError: ctx.pendingDeleteError,
    pendingAuthError: ctx.pendingAuthError,
    pendingPullDivergence: ctx.pendingPullDivergence,
    pendingPushNonFf: ctx.pendingPushNonFf,
    isLoadingHistoryMore: ctx.isLoadingHistoryMore,
    // ─── getters ───
    branches: ctx.branches,
    commits: ctx.commits,
    stashes: ctx.stashes,
    remotes: ctx.remotes,
    statusFiles: ctx.statusFiles,
    currentBranch: ctx.currentBranch,
    ahead: ctx.ahead,
    behind: ctx.behind,
    stagedFiles: ctx.stagedFiles,
    unstagedFiles: ctx.unstagedFiles,
    untrackedFiles: ctx.untrackedFiles,
    conflictedFiles: ctx.conflictedFiles,
    hasUncommitted: ctx.hasUncommitted,
    hasConflict: ctx.hasConflict,
    isBusy: ctx.isBusy,
    repoState: ctx.repoState,
    dirtyCountByProject: ctx.dirtyCountByProject,
    historyHasMore: ctx.historyHasMore,
    repos: ctx.repos,
    currentRepoPath: ctx.currentRepoPath,
    // ─── actions: context ───
    setSelectedProject: ctx.setSelectedProject,
    setSelectedRepo: ctx.setSelectedRepo,
    clearStatusForCurrentProject: ctx.clearStatusForCurrentProject,
    // ─── actions: data (read-side) ───
    discoverRepos: data.discoverRepos,
    loadStatus: data.loadStatus,
    loadHistory: data.loadHistory,
    loadMoreHistory: data.loadMoreHistory,
    loadBranches: data.loadBranches,
    loadStashes: data.loadStashes,
    loadRemotes: data.loadRemotes,
    subscribe: data.subscribe,
    initRepo: data.initRepo,
    // ─── actions: domain modules ───
    ...staging,
    ...sync,
    ...branches,
    ...history,
    ...conflicts,
  }
})
