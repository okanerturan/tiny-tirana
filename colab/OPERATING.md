# Running on Colab G4: rules

Sources: the CLI's own guide (`colab skill`), the lessons from the first Tirana build (`../../TiranaMap/CLI.md`), and web research (5 Nov 2026).

## Facts
- The G4 is an RTX PRO 6000 Blackwell with 96 GB. It costs about 8.7–10 CU/hr, the most expensive Colab GPU, at about $0.10 per CU.
- `colab new -s NAME --gpu G4` works. Adding `--high-mem` gets rejected ("no entitlement"), so leave it off.
- Billing runs while the VM is assigned, idle or not. `colab stop -s NAME` releases it. Check with `colab usage`.
- Kernel state persists between `colab exec` calls in the same session.
- The CLI's keep-alive daemon pings the VM every ~60 s, so the session doesn't need a browser tab. The daemon stops itself after 24 h.
- Google doesn't publish the idle limit (90 min is folklore). In the last build, idle or orphaned sessions were deleted about 45 min after the exec stream froze.

## Rules
1. **Long jobs run as a background process on the VM** (`subprocess.Popen` writing to a log), never inside the exec call itself. Exec streams freeze every 8–45 min, and a frozen exec must not kill the job.
2. **Poll with short exec cells** (`peek.py`, `--timeout 60`) every few minutes. Each poll is also activity on the kernel.
3. **Every job is resumable** (the sampler checkpoints its latent after every step), and its outputs are written atomically (tmp file, then rename).
4. **One job per session.** Before launching, check for duplicates with `pgrep -f '[j]oint.py'`. The `[x]` trick stops pgrep from counting itself.
5. **Pull results in parts and check sha256** before trusting them.
6. **No auto-kill guard** (Okan's call, 2026-11-05): a deadline kill can cut a long run in half. `guard.sh` stays in the repo but isn't used by default. Instead, stop the session by hand as soon as the results are downloaded, and record `colab usage` before and after every run.
7. **Never run `colab repl`, `console`, `auth` or `drivemount` from the agent.** They need a TTY.
8. **Pipe CLI output through** `sed -E 's#https?://[^ ]+#[URL]#g'` so token URLs never land in logs.
9. **Always `colab stop` when done.** No session is left running overnight unless a job is actively running.

## Idle sessions get dropped (2026-11-06)
Two freshly set-up G4 sessions (model installed, LoRA and shots uploaded) disappeared after ~45 min of sitting idle while a
decision was pending; `colab ls` then "pruned 2 stale local sessions". Create and set up extra GPUs only when the job can
start right after setup, or keep them busy. Painting jobs (blocks.py / joint.py) keep a session alive.

## Known limitation: height pass far from the anchor (2026-11-06)
Height-pass shots around the airport (camera v ≈ -50000 … -71680, ~13 km from the anchor) come back with every pixel at the
range floor, even with --h0 -400. Colour shots there are fine. Not needed today (no vehicles at the airport; planes use a
fixed airport ground of 74 m that matches the painted runway), so the airport has no occlusion/street-level grid.
To investigate: world z precision / the tiles group transform for far tiles in render/app.js captureHeight.
