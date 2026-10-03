# Creating the rover's Claude Project

Projects are created only in the Claude app (web, desktop or mobile); nothing
here can do it for you. Each step says which file goes in which field. Copy
each file whole.

| File | Goes in |
|---|---|
| [goal.md](goal.md) | the Project's **Goal** field: your standing goals, read by the project conversation |
| [instructions.md](instructions.md) | the Project's **Project instructions** field: sent to every thread, so it repeats the standing goals |
| [environment.sh](environment.sh) | the environment's **setup script** |
| [handoff.md](handoff.md) | nowhere: it stays in the repo, and threads read it |

## Steps

1. **GitHub access.** Done: BeeBeRBaB has write access to
   `shogowarrior/rover` (granted 2026-10-03).
2. **Create the Project** on the repository `shogowarrior/rover`, branch
   `main`.
3. **Goal:** paste [goal.md](goal.md).
4. **Project instructions:** paste [instructions.md](instructions.md).
5. **Environment.** The setup script belongs to a cloud environment, not to
   the Project. Environments are shared by every Project that picks them, so
   make one for the rover rather than editing Default (word-finder may use
   it):
   - At claude.ai/code, click the cloud icon above the message box, open
     **Cloud**, and click **Add cloud environment**.
   - **Name:** `rover`.
   - **Setup script:** paste [environment.sh](environment.sh). It installs
     `jq`, Node 22 and PlatformIO. Without `jq` the repo's secrets guard
     blocks every tool call, and a thread cannot install it from inside, so
     the script fails loudly instead. It runs as root on Ubuntu 24.04, once;
     every thread then starts from that cached result, until the script or
     the network setting changes (or after about 7 days).
   - **Network access:** **Custom**, allowing the distribution's apt
     mirrors, `pypi.org`, `files.pythonhosted.org`,
     `api.registry.platformio.org`, `dl.registry.platformio.org`,
     `deb.nodesource.com`, `registry.npmjs.org`, `cdn.playwright.dev`,
     `playwright.download.prss.microsoft.com`, GitHub, and
     `cdn.jsdelivr.net` (the panel loads Blockly from it). **Full** also
     works.
6. **Point the Project at it:** in the Project, open **Project settings >
   Environment** and pick `rover`.
7. **Models and effort:** gear icon in the Project's header > **Project
   settings** > **General**: **Thread model** and **Thread effort** for the
   threads, **Coordinator model** and **Coordinator effort** for the project
   conversation. The defaults are Opus everywhere, high effort for threads
   and low for the conversation. A running thread's own model picker, in its
   header, overrides them for that thread.
8. **Start it.** A new Project waits for your first message (only an
   account's very first Project starts by itself). Send:

   > Read docs/project/handoff.md and start the current work at step 1.

   The project conversation then plans the work and starts a thread for
   each item, one at a time.

## Keeping these in step

- When you edit a field in the Project, update its file here in the same
  change.
- [handoff.md](handoff.md) carries the current work. Threads update it in
  every PR, so the next thread finds it current. When the current work is
  done, the last thread writes what is next there.
- A rule that belongs to the repo goes in AGENTS.md or CLAUDE.md, which every
  thread loads anyway. The instructions carry only what a cloud thread
  cannot get from the repo: the owner's standing goals and preferences, the
  cloud's limits, and the setup.
