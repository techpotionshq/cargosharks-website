# The CI runner image: the upstream runner plus what Chromium needs to start.
#
# Built by Coolify from this file (infra/ci-runner/docker-compose.yml names it)
# and by nothing in CI: `scripts/ci-scope.mjs` treats this folder as lint-only.
#
# Why an image of our own. The end-to-end jobs need Chromium's system
# libraries, and the upstream image has none of them. They used to be
# installed per job with `playwright install --with-deps`, as root: an
# `apt-get update` every run, and on every fresh container (a redeploy, a
# second runner) a few hundred megabytes of packages before the first test.
# Baked in here, the jobs detect that the libraries are present and install
# nothing (`.github/actions/playwright`). Detect rather than assume, so an
# image that drifts behind the repository's Playwright version costs one
# install in a job, not a failure.
#
# What is NOT here, deliberately: Node, pnpm, the browsers themselves. Node
# and pnpm are pinned by the workflows and installed per job into the tool
# cache; the browsers are downloaded by the job into the tool cache for the
# exact Playwright version the lockfile holds. Baking either in would make
# this image the thing to rebuild on every bump.
#
# Pinned to a dated runner release and its digest (the multi-platform index,
# as Docker Hub lists it for the tag). The runner updates itself in place when
# GitHub requires a newer version, so an old pin keeps working; bump it when
# convenient, with the digest, rather than following `ubuntu-noble`, which
# moves daily.
FROM myoung34/github-runner:2.337.0-ubuntu-noble@sha256:1b947d2475cc6f4c3edf0e91dd879b091857e41a311be917016243479bb34101

# Keep in step with `@playwright/test` in pnpm-lock.yaml (1.62.1 when this was
# written). A mismatch is not an error: the job notices a missing library and
# installs it, at the cost of time.
ARG PLAYWRIGHT_VERSION=1.62.1

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# One layer, cleaned up inside it.
#
# `playwright install-deps` is the authority on what Chromium needs on this
# Ubuntu release, and it is a Node program. The image's own Node is Ubuntu's,
# without npm, so a Node 22 tarball is fetched, checked against nodejs.org's
# published checksums, used for this one command and deleted.
#
# fonts-noto-core for Arabic: Playwright's dependency list carries Latin, CJK
# and emoji faces, and half of every screen here is Arabic. Without a face for
# it Chromium renders boxes, which every screenshot and visual check would
# record. Noto Naskh and Noto Sans Arabic are both in this package.
RUN set -eux; \
    cd /tmp; \
    curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt; \
    tarball=$(grep -oE 'node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.gz' SHASUMS256.txt | head -n1); \
    curl -fsSLO "https://nodejs.org/dist/latest-v22.x/${tarball}"; \
    grep " ${tarball}\$" SHASUMS256.txt | sha256sum -c -; \
    mkdir node; \
    tar -xzf "${tarball}" -C node --strip-components=1; \
    PATH="/tmp/node/bin:${PATH}" npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium; \
    apt-get install -y --no-install-recommends fonts-noto-core; \
    fc-list :lang=ar | grep -q .; \
    rm -rf /tmp/node /tmp/node-v22* /tmp/SHASUMS256.txt /root/.npm /var/lib/apt/lists/*

# Entrypoint and command are the upstream image's.
