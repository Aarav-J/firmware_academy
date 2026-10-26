#!/usr/bin/env python3
"""Fetch pinned Zephyr sources into .stm32 and build the editable STM32 proof.

Usage: python3 scripts/setup-zephyr-proof.py
Requires Python >= 3.10, git, cmake, ninja, dtc, gperf, and arm-none-eabi-gcc.
No SDK, global pip install, or existing west workspace is used or modified.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".stm32"
WORKSPACE = CACHE / "zephyr-workspace"
ZEPHYR = WORKSPACE / "zephyr"
ENVIRONMENT = CACHE / "zephyr-venv"
BUILD = CACHE / "zephyr-build"
REVISION = "64e98eb5278d790f3b3e5279ca8b39b45097bbc0"  # Zephyr v4.2.1
BOARD = "stm32f4_disco/stm32f407xx"
MODULES = ("cmsis", "cmsis_6", "hal_stm32")


def run(*args, cwd=ROOT, env=None, capture=False):
    print("+", " ".join(map(str, args)), flush=True)
    result = subprocess.run(
        list(map(str, args)), cwd=cwd, env=env, check=True,
        text=True, stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-only", action="store_true",
                        help="rebuild previously initialized sources without network access")
    parser.add_argument("--jobs", type=int, default=min(os.cpu_count() or 2, 8))
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        parser.error("Python >= 3.10 is required")
    if args.jobs < 1:
        parser.error("--jobs must be positive")
    for executable in ("git", "cmake", "ninja", "dtc", "gperf", "arm-none-eabi-gcc"):
        if not shutil.which(executable):
            parser.error(f"required executable not found on PATH: {executable}")

    CACHE.mkdir(exist_ok=True)
    python = ENVIRONMENT / "bin" / "python"
    west = ENVIRONMENT / "bin" / "west"
    env = dict(os.environ)
    # Avoid accidentally inheriting the user's unrelated Zephyr/SDK workspace.
    for key in ("ZEPHYR_BASE", "ZEPHYR_SDK_INSTALL_DIR", "ZEPHYR_MODULES",
                "ZEPHYR_EXTRA_MODULES", "BOARD_ROOT", "SOC_ROOT", "DTS_ROOT"):
        env.pop(key, None)
    env["PATH"] = str(ENVIRONMENT / "bin") + os.pathsep + env["PATH"]
    env["ZEPHYR_BASE"] = str(ZEPHYR)
    env["ZEPHYR_TOOLCHAIN_VARIANT"] = "cross-compile"
    compiler = Path(shutil.which("arm-none-eabi-gcc"))
    env["CROSS_COMPILE"] = str(compiler.parent / "arm-none-eabi-")
    env["PIP_CACHE_DIR"] = str(CACHE / "pip-cache")
    env["PYTHONNOUSERSITE"] = "1"

    if not args.build_only:
        WORKSPACE.mkdir(exist_ok=True)
        if not (ZEPHYR / ".git").exists():
            run("git", "init", ZEPHYR)
            run("git", "-C", ZEPHYR, "remote", "add", "origin",
                "https://github.com/zephyrproject-rtos/zephyr.git")
        current = run("git", "-C", ZEPHYR, "rev-parse", "--verify", "HEAD",
                      capture=True) if (ZEPHYR / ".git" / "HEAD").exists() and (ZEPHYR / "VERSION").exists() else None
        if current != REVISION:
            run("git", "-C", ZEPHYR, "fetch", "--depth", "1", "origin", REVISION)
            run("git", "-C", ZEPHYR, "checkout", "--detach", REVISION)
        if not python.exists():
            venv.EnvBuilder(with_pip=True).create(ENVIRONMENT)
        run(python, "-m", "pip", "install", "-r", ZEPHYR / "scripts" / "requirements-base.txt",
            "west==1.5.0", env=env)
        if not (WORKSPACE / ".west" / "config").exists():
            run(west, "init", "-l", ZEPHYR, cwd=WORKSPACE, env=env)
        # All other west projects remain unfetched and excluded from module discovery.
        run(west, "config", "manifest.project-filter", "--", "-.*,+cmsis,+cmsis_6,+hal_stm32",
            cwd=WORKSPACE, env=env)
        run(west, "update", "--narrow", "--fetch-opt=--depth=1", *MODULES,
            cwd=WORKSPACE, env=env)
    elif not python.exists() or not (ZEPHYR / "VERSION").exists():
        parser.error("run without --build-only to initialize .stm32 first")

    current = run("git", "-C", ZEPHYR, "rev-parse", "HEAD", capture=True)
    if current != REVISION:
        parser.error(f"Zephyr revision mismatch: expected {REVISION}, found {current}")
    module_paths = [WORKSPACE / "modules" / "hal" / name.replace("hal_", "")
                    for name in MODULES]
    for module in module_paths:
        if not (module / ".git").exists():
            parser.error(f"missing module {module}; run without --build-only")
    run("cmake", "-S", ROOT / "proofs" / "stm32" / "zephyr", "-B", BUILD,
        "-G", "Ninja", f"-DBOARD={BOARD}", f"-DPython3_EXECUTABLE={python}",
        f"-DPYTHON_EXECUTABLE={python}", "-DZEPHYR_TOOLCHAIN_VARIANT=cross-compile",
        f"-DCROSS_COMPILE={env['CROSS_COMPILE']}",
        f"-DUSER_CACHE_DIR={CACHE / 'zephyr-cache'}",
        "-DZEPHYR_MODULES=" + ";".join(map(str, module_paths)),
        "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON", env=env)
    run("cmake", "--build", BUILD, "--parallel", args.jobs, env=env)
    elf = BUILD / "zephyr" / "zephyr.elf"
    if not elf.is_file():
        raise RuntimeError(f"build did not produce {elf}")
    manifest = {
        "zephyrVersion": "4.2.1", "zephyrRevision": REVISION, "board": BOARD,
        "source": str(ROOT / "proofs" / "stm32" / "zephyr"), "elf": str(elf),
        "compiler": str(compiler),
        "modules": {name: run("git", "-C", path, "rev-parse", "HEAD", capture=True)
                    for name, path in zip(MODULES, module_paths)},
    }
    (CACHE / "zephyr-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Zephyr source proof built: {elf}")


if __name__ == "__main__":
    main()
