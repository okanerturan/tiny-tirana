#!/bin/bash
# Publish the current tree to the PUBLIC repo (github.com/okanerturan/tiny-tirana) as one new snapshot commit.
# The private repo (origin, tiny-tirana-dev) keeps the full history, which includes Google-render material that must
# not be published; the public repo only ever gets trees from HEAD, which .gitignore keeps clean.
#   deploy/publish_repo.sh "message"
set -e; cd "$(dirname "$0")/.."
git remote get-url public >/dev/null 2>&1 || git remote add public https://github.com/okanerturan/tiny-tirana.git
git fetch -q public 2>/dev/null || true
for d in viewer/pairs viewer/compare viewer/orbit viewer/orbit8 viewer/scenes viewer/eval_v3 viewer/rotate viewer/style; do
  [ -z "$(git ls-tree -r --name-only HEAD -- $d)" ] || { echo "refusing: $d is tracked"; exit 1; }
done
parent=$(git rev-parse -q --verify public/main || true)
# internal notes stay private (PLAN.md is the original build plan: outdated, local paths)
EXCLUDE="PLAN.md"
idx=$(mktemp); GIT_INDEX_FILE=$idx git read-tree HEAD
for f in $EXCLUDE; do GIT_INDEX_FILE=$idx git rm -q --cached --ignore-unmatch -- "$f"; done
tree=$(GIT_INDEX_FILE=$idx git write-tree); rm -f "$idx"
c=$(git commit-tree $tree ${parent:+-p $parent} -m "${1:-Update}")
git push -q public "$c:refs/heads/main" && echo "published $c"
