# One image definition, three services.
#
# The build context is the REPO ROOT, not a service directory. shared/auth.ts
# is imported across sibling directories ("../../shared/auth.js"), so no
# service can be built on its own -- a Dockerfile with a service directory as
# its context cannot see the module that verifies its tokens.
FROM node:20-alpine

# kavach-engine | stt-service | evidence-service
ARG SERVICE
RUN test -n "$SERVICE" || (echo "build arg SERVICE is required" && exit 1)

WORKDIR /app

# shared/ first: it changes least, so the layer caches across all three builds.
COPY shared ./shared

# Manifests before source, so npm ci is not re-run on every code edit.
COPY ${SERVICE}/package.json ${SERVICE}/package-lock.json ./${SERVICE}/
RUN cd ${SERVICE} && npm ci --omit=dev

# tsx is a runtime dependency, not a dev one: there is no build step that
# produces something runnable, so --omit=dev must still leave the interpreter
# behind. That is why it was moved out of devDependencies.
COPY ${SERVICE} ./${SERVICE}

# ARG expands in WORKDIR at build time, which is what lets CMD stay static.
WORKDIR /app/${SERVICE}

# Run as the node user. Volume mounts are chowned in compose.
USER node

CMD ["npm", "start"]
