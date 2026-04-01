# Server Guide

Last updated: 2026-03-28

## Servers

### SG-Lab — `5.223.66.111`
- **Owner:** Personal
- **Environment:** Lab / Sandbox
- **Location:** Singapore
- **Purpose:** Prototyping, internal experiments, fleet agent operations
- **Services:**
  - SysBuilder V1 + V2
  - speech-relay
  - PocketBase
  - Happy Server
  - Fleet agents (Carmack, Thompson, Knuth)
- **Access:** SSH key auth only (Tailscale or direct)
- **Notes:**
  - Root disk filled up on 2026-03-28 — monitor disk space regularly
  - Docker-compose labels things "prod" but this is NOT production
  - Not part of the formal deploy pipeline

### SG-Dev — `47.79.4.19`
- **Owner:** Company
- **Environment:** DEV
- **Location:** Singapore
- **Purpose:** Shared development for all team members
- **Services:**
  - SysBuilder (PostgreSQL, Redis, Neo4j, Java backend, React frontend, nginx)
- **Access:** SSH root with password auth
- **Notes:**
  - Use `docker-compose-prod.yml` (not the base `docker-compose.yml`) for the full stack
  - Neo4j password must not contain `!` (Docker Compose .env strips it)
  - Ubuntu 24.04, set up 2026-03-27

### DE-Lab — `46.225.129.65`
- **Owner:** Personal
- **Environment:** Lab
- **Location:** Nuremberg, Germany
- **Purpose:** Second personal server, separate product line
- **Services:**
  - Amazon Listing app (`amzl.latentweave.com`)
  - Image CDN
- **Notes:**
  - Not part of the SysBuilder pipeline

### Original Demo — `8.x.x.x` (TBD)
- **Owner:** TBD
- **Environment:** TBD (likely PROD)
- **Purpose:** Customer-facing demo
- **Notes:**
  - IP to be confirmed
  - Role and deploy process to be decided

## Deploy Flow

```
Develop on SG-Lab -> Verify on SG-Lab -> Push to Gitee -> Deploy to SG-Dev (from Gitee) -> Verify on SG-Dev
```

- SG-Lab is where development and first testing happens
- Only push to Gitee after verification on SG-Lab
- SG-Dev always pulls from Gitee — never directly from SG-Lab
- Gitee is the gate between environments
- PROD only gets deploys that pass verification on SG-Dev

## Rules

1. Use the server names above (SG-Lab, SG-Dev, DE-Lab) in all communication
2. Do not trust "prod" labels in docker-compose files — check which server you are on
3. Monitor SG-Lab disk space — fleet agents and docker images consume storage
4. Always use `docker-compose-prod.yml` on SG-Dev for full stack deployments
5. Avoid special characters (`!`, `$`, etc.) in .env passwords — Docker Compose may strip them
