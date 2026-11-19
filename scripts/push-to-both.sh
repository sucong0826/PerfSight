#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

usage() {
  printf 'Usage: %s [branch] [--tag version-tag]\n' "$0" >&2
  exit 2
}

branch="$(git -C "$REPO_ROOT" branch --show-current)"
branch_override=""
tag_name=""

while (($#)); do
  case "$1" in
    --tag)
      [[ -z "$tag_name" && $# -ge 2 ]] || usage
      tag_name="$2"
      shift
      ;;
    -*)
      usage
      ;;
    *)
      [[ -z "$branch_override" ]] || usage
      branch_override="$1"
      ;;
  esac
  shift
done

if [[ -n "$branch_override" ]]; then
  branch="$branch_override"
fi

[[ -n "$branch" ]] || {
  printf 'Push error: checkout a branch or pass its name explicitly.\n' >&2
  exit 1
}
git -C "$REPO_ROOT" check-ref-format --branch "$branch" >/dev/null

for remote in origin gitlab; do
  git -C "$REPO_ROOT" remote get-url "$remote" >/dev/null 2>&1 || {
    printf 'Push error: remote "%s" is not configured.\n' "$remote" >&2
    exit 1
  }
done

local_ref="refs/heads/${branch}"
git -C "$REPO_ROOT" show-ref --verify --quiet "$local_ref" || {
  printf 'Push error: local branch "%s" does not exist.\n' "$branch" >&2
  exit 1
}

if ! git -C "$REPO_ROOT" diff --quiet "$local_ref" -- \
  || ! git -C "$REPO_ROOT" diff --cached --quiet "$local_ref" --; then
  printf 'Push error: commit tracked file changes before syncing. The sync uses the committed branch tree.\n' >&2
  exit 1
fi

if [[ -n "$tag_name" ]]; then
  git -C "$REPO_ROOT" check-ref-format "refs/tags/${tag_name}" >/dev/null || usage
  git -C "$REPO_ROOT" show-ref --verify --quiet "refs/tags/${tag_name}" || {
    printf 'Push error: local tag "%s" does not exist.\n' "$tag_name" >&2
    exit 1
  }
  tag_commit="$(git -C "$REPO_ROOT" rev-parse "refs/tags/${tag_name}^{commit}")"
  if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$tag_commit" "$local_ref"; then
    printf 'Push error: tag "%s" does not point to a commit on branch "%s".\n' "$tag_name" "$branch" >&2
    exit 1
  fi
fi

# GitHub is the client-build source of truth. Publish there first so GitLab's
# repository rules cannot prevent GitHub Actions builds.
printf 'Pushing branch %s to GitHub (origin)...\n' "$branch"
git -C "$REPO_ROOT" push origin "${local_ref}:${local_ref}"

if [[ -n "$tag_name" ]]; then
  printf 'Pushing tag %s to GitHub (origin)...\n' "$tag_name"
  git -C "$REPO_ROOT" push origin "refs/tags/${tag_name}:refs/tags/${tag_name}"
fi

gitlab_branch_line="$(git -C "$REPO_ROOT" ls-remote --heads gitlab "$branch")" || {
  printf 'Push error: could not read GitLab branch "%s". GitHub is current; check GitLab connectivity and permissions.\n' "$branch" >&2
  exit 1
}
[[ -n "$gitlab_branch_line" ]] || {
  printf 'Push error: GitLab branch "%s" does not exist. GitHub is current; reconcile the initial GitLab migration first.\n' "$branch" >&2
  exit 1
}

remote_ref="refs/remotes/gitlab/${branch}"
git -C "$REPO_ROOT" fetch --no-tags gitlab "refs/heads/${branch}:${remote_ref}"

# GitLab only needs the current source tree for internal deployment. Build a
# single child commit on top of GitLab's current branch so old GitHub history
# (including removed generated binaries) is not sent to GitLab.
source_tree="$(git -C "$REPO_ROOT" rev-parse "${local_ref}^{tree}")"
source_commit="$(git -C "$REPO_ROOT" rev-parse "$local_ref")"
while IFS= read -r -d '' path; do
  lower_path="$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower_path" =~ \.(ar|war|tar|gz|zip|exe|pkg|dmg|dll|app|bundle|dylib|framework|h5|pt|pth|bin|onnx|model|pkl|vct|mar|pte|pt2|ptl|safetensors|keras|pb|ckpt|tflite|tfrecords|npy|npz|gguf|ggml|ggmf|ggjt|nc|mleap|coreml|surml|llamafile|prompt|dlc|caffemodel|prototxt|a|o|so)$ ]]; then
    printf 'Push error: current source tree contains GitLab-prohibited file %q. GitHub is current; remove it from the branch tip before syncing.\n' \
      "$path" >&2
    exit 1
  fi
done < <(git -C "$REPO_ROOT" ls-tree --full-tree -r --name-only -z "$source_tree")

gitlab_tree="$(git -C "$REPO_ROOT" rev-parse "${remote_ref}^{tree}")"
if [[ "$source_tree" == "$gitlab_tree" ]]; then
  printf 'GitLab already has the same source tree on branch %s.\n' "$branch"
else
  snapshot_commit="$(printf 'Sync PerfSight source tree from GitHub\n\nSource-Branch: %s\nSource-Commit: %s\n' \
    "$branch" "$source_commit" | git -C "$REPO_ROOT" -c commit.gpgsign=false commit-tree "$source_tree" -p "$remote_ref")"

  printf 'Pushing source snapshot to GitLab branch %s...\n' "$branch"
  if ! git -C "$REPO_ROOT" push gitlab "${snapshot_commit}:refs/heads/${branch}"; then
    printf 'GitHub is current, but GitLab is behind. Check GitLab branch protection and prohibited-file rules; no history was rewritten.\n' >&2
    exit 1
  fi
fi

printf 'GitHub branch %s' "$branch"
if [[ -n "$tag_name" ]]; then
  printf ' and GitHub tag %s' "$tag_name"
fi
printf ' are current; GitLab branch %s now has the matching source tree.\n' "$branch"
