FROM redis:7.4.6-alpine@sha256:3b73847e72874be07e6657b129a94761662b79bc0f679273757d4218573b2a98
COPY --chmod=755 start.sh /usr/local/bin/assessment-redis
ENTRYPOINT ["/usr/local/bin/assessment-redis"]
