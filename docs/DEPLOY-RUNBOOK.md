# Deploy Runbook

## Flow
```
Code on SG-Lab → Verify on SG-Lab → Push to Gitee → Linus deploys to SG-Dev → Knuth verifies
```

## SG-Lab (Hot Reload Dev)
Backend runs natively via `./run-dev.sh`. DB services stay in Docker.

**Start dev backend:**
```bash
cd ~/workspace/sysbuilder-java
./run-dev.sh
```

**After code changes:**
```bash
./mvnw compile -q -Dskip.npm -Dskip.installnodenpm
# DevTools auto-restarts in ~5 seconds
```

**Frontend rebuild:**
```bash
cd frontend && npm run build
# Copy dist to nginx volume via rootlesskit
```

## SG-Dev (Docker)
Full stack in Docker via `docker-compose-prod.yml`.

**Deploy steps (Linus runs these):**
1. `ssh root@47.79.4.19`
2. `cd /opt/sysbuilder/deploy`
3. `git pull origin develop`
4. Backend: `docker compose -f docker-compose-prod.yml build backend && docker compose -f docker-compose-prod.yml up -d backend`
5. Frontend: copy built dist to `frontend-dist/`, restart nginx
6. Verify: `curl localhost` returns new bundle hash

## Verification Checklist (Knuth)
After every deploy, verify:
- [ ] Login works (admin / admin123)
- [ ] Projects list loads (7 projects)
- [ ] Story map loads with data (check 2+ projects)
- [ ] No duplicate epics or stories
- [ ] Glossary shows term counts
- [ ] Story card click opens modal
- [ ] DnD moves story without duplication
- [ ] Frontend bundle hash matches expected

## Rollback
If deploy breaks:
1. `git checkout HEAD~1` on the server
2. Rebuild and restart
3. Investigate before re-deploying
