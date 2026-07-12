# Pin by digest, NOT the mutable :2.1.9 tag. Get the current digest with:
#   docker pull --platform linux/amd64 factoriotools/factorio:2.1.9
#   docker inspect --format='{{index .RepoDigests 0}}' factoriotools/factorio:2.1.9
# then paste it below.
FROM factoriotools/factorio@sha256:ff1c21dda4d1ab52bcc53fc5ad9508cfcc102c966a0a655051acefbf49bd6bcb

# Node for the HTTP wrapper (base image is Debian-based).
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# Fail fast if the pinned Factorio is not 2.1.9.
RUN /opt/factorio/bin/x64/factorio --version | grep -q "Version: 2.1.9"

WORKDIR /app
COPY render.mjs server.mjs ./
EXPOSE 8080
ENTRYPOINT ["node", "/app/server.mjs"]
