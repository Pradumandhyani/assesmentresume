# Trusted build only. BASE_IMAGE must be resolved to a reviewed immutable digest by build-toolchains.mjs.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN groupadd --gid 10001 student \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin student \
    && mkdir -p /work \
    && chown 10001:10001 /work \
    && chmod 0700 /work
WORKDIR /work
USER 10001:10001
