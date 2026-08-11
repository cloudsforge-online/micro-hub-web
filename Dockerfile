# syntax=docker/dockerfile:1
#
# Two stages: build the bundle, then serve it. The final image contains no Node, no toolchain, no
# source and no secret — an SPA is static files, and everything else in the image is attack
# surface for something it does not need to do.
#
# THE IMAGE CARRIES NO ENVIRONMENT. It is built once, tagged once, and the same tag is promoted
# from staging to production; the hosts it talks to are resolved in the browser from the address
# the page was served on. There is deliberately no build arg for an API URL, and adding one would
# undo the property this app inherits from the web template.
#
# ONE RUNTIME VARIABLE EXISTS AND IT DOES NOT BEND THAT (micro-org#406). `POOL_API_PRESENCE` is
# read by the CONTAINER at start, not by the build: nginx renders it into `/deployment.json` and the
# same bytes of bundle serve every estate. The bottom of this file argues it in full, and the
# distinction is the whole point — a build arg produces a different artefact per environment, which
# is what "built once and promoted" forbids.

# The named context is the unpublished @cloudsforge/ui workspace, mirroring the `link:` specifier
# in package.json. It disappears when the package is published.
#   docker build -t hub-web --build-context uipkg=../ui .

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# The linked package must exist before `pnpm install` resolves the dependency, and it is copied
# first because it changes far less often than this app's source.
COPY --from=uipkg packages/ui /ui/packages/ui
# esbuild reads the nearest tsconfig for each file it transforms, and the design system's extends
# the one at its repository root. Without it the build fails inside a file this app does not own.
COPY --from=uipkg tsconfig.base.json /ui/tsconfig.base.json

# pnpm-workspace.yaml carries the esbuild build-script allowance; without it the toolchain
# installs and then cannot run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# The release identity: the git sha, stamped into the meta tag src/lib/obs.ts reads, so an error
# report names the deploy that produced it. It identifies the artefact; it does not configure it.
ARG RELEASE=dev
RUN sed -i "s|name=\"cf-release\" content=\"dev\"|name=\"cf-release\" content=\"${RELEASE}\"|" index.html \
 && pnpm build

# nginx-unprivileged: the server runs as uid 101 and listens on 8080. A static file server has no
# reason to be root, and a container that cannot become root cannot be made to write anywhere.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# ── THE ONE FACT THIS IMAGE CANNOT CARRY, AND HOW IT ARRIVES ANYWAY (micro-org#406) ─────────────
#
# Whether the estate this container is deployed on runs a mining pool API. The image is built once
# and promoted by digest, so it cannot know; the CONTAINER can. The stock entrypoint
# (`/docker-entrypoint.d/20-envsubst-on-templates.sh`) expands this template into
# `/etc/nginx/conf.d/deployment.inc` from `POOL_API_PRESENCE` in the environment, before nginx
# starts, and `nginx.conf` includes it inside `location = /deployment.json`. The argument in full,
# including why the output is `.inc` and not `.conf`, is in nginx.conf under "IS THERE A MINING POOL
# ON THIS DEPLOYMENT AT ALL?".
COPY deployment.inc.template /etc/nginx/templates/deployment.inc.template

# ── AND THE DEFAULT, WHICH IS NOT OPTIONAL AND WAS FOUND BY RUNNING THE IMAGE ───────────────────
#
# MEASURED 2026-08-11 on micro-pool-web's identical mechanism, building the image and starting it
# with no environment: the container EXITED 1 with
# `nginx: [emerg] unknown "pool_api_presence" variable`.
#
# The entrypoint does not substitute every `${...}` it finds. It builds its list from the variables
# that are actually SET — `envsubst "$defined_envs"` over `printenv | cut -d= -f1` — so an unset
# variable is left in the output verbatim, reaches nginx as an nginx variable reference, and the
# config fails to parse. Not a wrong document: no server at all, on every deployment that had never
# heard of the flag. `ENV` rather than a default inside the template because envsubst implements
# only `$VAR` and `${VAR}` and has no `${VAR:-default}` — this is the one place the default can be.
#
# `present` rather than the empty string. Both read as "there is a pool" (`src/lib/deployment.tsx`
# treats only the exact string `absent` as absence), but a document saying `{"poolApi":"present"}`
# states the assumption an operator is looking at, where an empty field looks like a broken
# mechanism.
ENV POOL_API_PRESENCE=present

EXPOSE 8080

# Liveness only. It proves nginx is answering, not that the app works — a static server cannot
# know whether hub-api behind the page is healthy, and pretending otherwise is how a green probe
# outlives a broken product.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
