"""Stdio launcher with a POSIX per-user single-instance lock."""
import os
from pathlib import Path
import stat
import sys

from .server import build_server


def _lock_instance():
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError("Single-instance protection unavailable on this platform")
    import fcntl

    configured = os.environ.get("RESEARCH_MCP_STATE_DIR")
    directory = Path(configured) if configured else Path.home() / ".cache" / "originium-research-mcp"
    if not directory.is_absolute():
        raise RuntimeError("State directory must be absolute")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(dir_fd)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError("State directory must be private and owned by this user")
        flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
        fd = os.open("instance.lock", flags, 0o600, dir_fd=dir_fd)
    finally:
        os.close(dir_fd)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise RuntimeError("Unsafe instance lock")
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another research MCP instance is active") from None
        return fd
    except BaseException:
        os.close(fd)
        raise


def main():
    try:
        lock_fd = _lock_instance()
    except OSError:
        print("research MCP launcher: cannot safely open private instance lock", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print("research MCP launcher: " + str(exc), file=sys.stderr)
        return 1
    try:
        build_server().run(transport="stdio")
        return 0
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    raise SystemExit(main())
