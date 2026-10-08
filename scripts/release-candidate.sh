#!/usr/bin/env bash
# Validate and package a release candidate of the card app, on this machine, without
# publishing anything. This was a manually dispatched workflow; the repository keeps one
# workflow, ci.yml (CONVENTIONS.md, "CI"), so the same steps run here instead.
#
#   bash scripts/release-candidate.sh [version]      # default 0.1.0-candidate
#
# Needs Node 22, npm, Docker, curl and jq. It runs the whole gate, builds the cards image,
# checks that a goal survives a container restart on a throwaway volume, and writes the
# image archive, the candidate Compose file and the self-hosting notes to release/. No
# registry is contacted and nothing is pushed.
set -euo pipefail

RELEASE_VERSION="${1:-0.1.0-candidate}"
if ! [[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "not a version: $RELEASE_VERSION" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

npm ci
npm run check
npx playwright install chromium
npm run test:e2e

docker build --build-arg APP=cards -t "collectcollect-cards:$RELEASE_VERSION" .

cleanup() {
  docker logs cards || true
  docker rm -f cards > /dev/null 2>&1 || true
  docker volume rm candidate-data > /dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:3000/api/health > /dev/null; then return 0; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:3000/api/health
}

docker run -d --name cards -p 127.0.0.1:3000:3000 -v candidate-data:/data "collectcollect-cards:$RELEASE_VERSION"
wait_healthy
curl -fsS http://127.0.0.1:3000/goals > /dev/null
goal=$(curl -fsS -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' --data '{"name":"Candidate persistence check"}' http://127.0.0.1:3000/api/goals)
docker restart cards
wait_healthy
curl -fsS http://127.0.0.1:3000/api/goals | jq -e --arg id "$(jq -r .goal.id <<< "$goal")" '.goals | any(.id == $id)' > /dev/null

rm -rf release
mkdir -p release
docker save "collectcollect-cards:$RELEASE_VERSION" | gzip > "release/collectcollect-cards-$RELEASE_VERSION.tar.gz"
cp compose.candidate.yaml .env.example docs/SELF_HOSTING.md docs/CHANGELOG.md release/
printf 'COLLECTCOLLECT_VERSION=%s\n' "$RELEASE_VERSION" > release/candidate.env
echo "release/ holds the validated candidate $RELEASE_VERSION"
