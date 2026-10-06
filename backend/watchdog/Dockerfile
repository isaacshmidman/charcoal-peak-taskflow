# The tunnel watchdog (see main.js).
#
# Same base image as the app, so the box already has it: nothing extra to
# download, and this builds in seconds. No dependencies — four files.
FROM node:22.14.0-slim

WORKDIR /watchdog

# The files are ES modules.
RUN echo '{"type":"module","private":true}' > package.json

COPY decide.js docker.js probes.js main.js ./

CMD ["node", "main.js"]
