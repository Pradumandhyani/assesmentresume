# Trusted local control plane. Student containers are always separate runsc guests.
FROM docker:29-dind@sha256:0b6d18a4a222e71c88be6034926b4f6cde2fc33c2218643d03ccfddc65995470
ARG GVISOR_RELEASE=20261005.0
RUN mkdir -p /opt/gvisor && cd /opt/gvisor \
    && wget -q https://storage.googleapis.com/gvisor/releases/release/${GVISOR_RELEASE}/$(uname -m)/gvisor.tar.bz2 \
    && wget -q https://storage.googleapis.com/gvisor/releases/release/${GVISOR_RELEASE}/$(uname -m)/gvisor.tar.bz2.sha512 \
    && sha512sum -c gvisor.tar.bz2.sha512 \
    && tar xjf gvisor.tar.bz2 \
    && rm gvisor.tar.bz2 gvisor.tar.bz2.sha512 \
    && chmod -R a+rX /opt/gvisor
ENV DOCKER_TLS_CERTDIR=""
VOLUME ["/opt/gvisor"]
CMD ["dockerd", "--host=unix:///run/assessment/docker.sock", "--add-runtime=runsc=/opt/gvisor/runsc", "--default-runtime=runc"]
