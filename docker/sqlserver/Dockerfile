# =============================================================================
# SQL Server 2022 Developer WITH Full-Text Search — Phase 17
# =============================================================================
#
# WHY THIS IMAGE EXISTS. The official `mcr.microsoft.com/mssql/server` images
# ship the database engine WITHOUT the Full-Text Search component:
# `SERVERPROPERTY('IsFullTextInstalled')` returns 0 on them. SQL Server FTS is
# the locked V1 search engine (TECH_STACK.md §10, ARCHITECTURE.md §4.3), so the
# local and CI database must actually have it. Microsoft distributes FTS for
# Linux as the separate `mssql-server-fts` package; this file adds exactly that
# and nothing else. No other search engine is introduced.
#
# EVERYTHING IS PINNED TO ONE ENGINE BUILD, deliberately.
#
#   - The base is SQL Server 2022 CU26 (16.0.4265.3), by DIGEST as well as by
#     tag. `2022-latest` floats: it had already moved past the engine the
#     persistent local volume was created on, so local and CI were silently
#     running different builds. A pinned digest makes both run the same one.
#
#   - `mssql-server-fts` must be the SAME build as the engine. The package
#     depends on `mssql-server`, which the official image does not register
#     with dpkg, so apt would otherwise install the newest engine package over
#     the image's binaries and move the engine forward underneath the volume.
#     Pinning BOTH packages to 16.0.4265.3-1 reinstalls the identical engine
#     build the base image already carries, and adds FTS beside it.
#
# Moving to a newer cumulative update is therefore a deliberate, reviewed edit
# of the three version strings below — never something a rebuild does on its
# own. An engine upgrade is one-way for the databases on the persistent volume.
#
# THE BUILD CONTEXT IS THIS DIRECTORY, and it contains only this file. Nothing
# from the repository — and in particular not the ignored `docker/.env` beside
# it — can reach this image's context (SECURITY_BASELINE.md §18.1).
#
# LICENCE. `mssql-server-fts` is a component of SQL Server itself, distributed
# by Microsoft from the same repository under the same SQL Server 2022 licence
# the Developer edition already runs under (TECH_STACK.md §18).
# =============================================================================

FROM mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg; \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-mssql-2022.gpg; \
    echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-mssql-2022.gpg] https://packages.microsoft.com/ubuntu/22.04/mssql-server-2022 jammy main' \
      > /etc/apt/sources.list.d/mssql-server-2022.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      mssql-server=16.0.4265.3-1 \
      mssql-server-fts=16.0.4265.3-1; \
    apt-get purge -y --auto-remove gnupg; \
    rm -rf /var/lib/apt/lists/*

# Back to the base image's unprivileged account. Its entrypoint and command are
# inherited unchanged.
USER mssql
