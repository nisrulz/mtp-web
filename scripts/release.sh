#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Release mtp-web.

Usage:
  scripts/release.sh <version> [--dry-run]
  VERSION=<version> DRY_RUN=1 scripts/release.sh

Steps:
  1. Switch to the default branch and update it.
  2. Verify that package.json already has the requested version.
  3. Run the checks.
  4. Tag the current commit.
  5. Push the tag to GitHub.
  6. Publish the package to npm.

The version bump happens in a pull request. Merge the pull request before you
run this script.

Options:
  --dry-run   Print the steps. Do not run them.
  -h, --help  Show this help.

Environment:
  VERSION     The release version, for example 0.2.0.
  DRY_RUN     Set to 1 to print the steps without a change.
EOF
}

info() {
  printf '\n==> %s\n' "$*"
}

run() {
  printf '    $'
  printf ' %s' "$@"
  printf '\n'

  if [[ "$dry_run" == "1" ]]; then
    return 0
  fi

  "$@"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

version="${VERSION:-}"
dry_run="${DRY_RUN:-0}"

for argument in "$@"; do
  case "$argument" in
    --dry-run)
      dry_run=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      fail "unknown option: $argument"
      ;;
    *)
      version="$argument"
      ;;
  esac
done

if [[ -z "$version" ]]; then
  usage >&2
  fail "a version is required"
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?(\+[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  fail "version '$version' is not a valid semantic version"
fi

if [[ "$dry_run" != "0" && "$dry_run" != "1" ]]; then
  fail "DRY_RUN must be 0 or 1"
fi

git rev-parse --show-toplevel >/dev/null 2>&1 || fail "run this script in a git repository"

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'error: the working tree has changes. Commit or stash them first.\n' >&2
  git status --short >&2
  exit 1
fi

package_name="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name")"

info "Fetch the tags and the default branch"
run git fetch origin --prune --tags

default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
default_branch="${default_branch#origin/}"
default_branch="${default_branch:-master}"

git show-ref --verify --quiet "refs/remotes/origin/$default_branch" ||
  fail "the default branch origin/$default_branch does not exist"

branch_version="$(
  git show "origin/$default_branch:package.json" |
    node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'
)"

if [[ "$version" != "$branch_version" ]]; then
  fail "origin/$default_branch has version $branch_version. Bump package.json in a pull request and merge it before you tag $version."
fi

if git show-ref --verify --quiet "refs/tags/v$version"; then
  fail "the tag v$version already exists"
fi

published_version="$(
  npm view "$package_name" version \
    --fetch-timeout=10000 \
    --fetch-retries=0 \
    2>/dev/null || true
)"

if [[ "$published_version" == "$version" ]]; then
  fail "$package_name $version is already published"
fi

if [[ "$dry_run" != "1" ]]; then
  npm whoami >/dev/null 2>&1 ||
    fail "npm is not authenticated. Run 'npm login' first."
fi

info "Release $package_name $version from $default_branch"

if [[ "$dry_run" == "1" ]]; then
  printf '    Dry run. The script does not change the repository or npm.\n'
fi

info "Switch to $default_branch"
run git switch "$default_branch"

info "Update $default_branch"
run git pull --ff-only origin "$default_branch"

info "Run the checks"
run make check

info "Verify the default branch matches origin"
if [[ "$dry_run" != "1" ]]; then
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse "origin/$default_branch")"
  if [[ "$local_head" != "$remote_head" ]]; then
    fail "$default_branch has commits that are not on origin/$default_branch. Push or remove them before you tag."
  fi
fi

info "Tag the current commit"
run git tag -a "v$version" -m "v$version"

info "Push the tag to GitHub"
run git push origin "v$version"

info "Publish the package to npm"
run npm publish --access public

if [[ "$dry_run" == "1" ]]; then
  info "Dry run complete. $package_name $version was not released."
else
  info "Released $package_name $version"
fi
