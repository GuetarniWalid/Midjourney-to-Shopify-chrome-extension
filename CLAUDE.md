# CLAUDE.md — MyselfMonArt Publisher (webapp) / repo extension-Midjourney

## Push & deployment autonomy (be proactive)
You are pre-authorized to commit AND push directly to `main` WITHOUT asking each time —
for THIS repo and the related `MyselfMonArt_Backend` repo. Be proactive: chain
implement → verify (typecheck/tests, and an adversarial review for risky changes) →
commit → push → deploy, without pausing for approval.

Only stop to ask when:
- the action is genuinely destructive/irreversible (history rewrite, force-push, deleting data/branches), or
- there is an ambiguous product decision the owner must make.

## How this project ships
- The **render server** runs on the PC (`webapp/`, `node server.js`, port 4000). Frontend
  files (`webapp/public/*.js|.html|.css`) are static → a **browser refresh** picks them up;
  only changes to `server.js` require restarting the render server.
- The **decor / insert / resize** image logic lives in the SEPARATE `MyselfMonArt_Backend`
  repo (AdonisJS). Pushing to its `main` triggers an **automatic prod deploy** (GitHub
  Actions → DigitalOcean). That is intended.

## Hygiene
- Stage ONLY the files for the task. Don't sweep unrelated untracked files (e.g.
  `webapp/_test_resize_ui.js`) or other in-progress work into a commit.
- Image-generation prompt changes can only be judged **visually** by the owner — ship them,
  then let him validate the render and iterate.

See the user memory (`MEMORY.md` and notes) for project history and decisions.
