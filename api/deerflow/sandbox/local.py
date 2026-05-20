import os
import shutil
import subprocess
import uuid
from pathlib import Path

from deerflow.sandbox.sandbox import Sandbox
from deerflow.sandbox.sandbox_provider import SandboxProvider
from deerflow.sandbox.search import GrepMatch, find_glob_matches, find_grep_matches


class LocalSandbox(Sandbox):
    """Root-bound local sandbox.

    This is a local workspace sandbox, not a strong security boundary for
    arbitrary untrusted code.
    """

    def __init__(self, id: str, root: str | Path, timeout_seconds: int = 60):
        super().__init__(id)
        self.root = Path(root).resolve()
        self.timeout_seconds = timeout_seconds
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, path: str | Path) -> Path:
        raw_path = Path(path)
        candidate = raw_path if raw_path.is_absolute() else self.root / raw_path
        resolved = candidate.resolve(strict=False)
        if not resolved.is_relative_to(self.root):
            raise PermissionError(f"Path escapes sandbox root: {path}")
        return resolved

    def _resolve_existing_path(self, path: str | Path) -> Path:
        resolved = self._resolve_path(path)
        if resolved.exists() and resolved.resolve().is_relative_to(self.root):
            return resolved.resolve()
        return resolved

    def execute_command(self, command: str) -> str:
        result = subprocess.run(
            ["/bin/sh", "-c", command],
            cwd=self.root,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
        )
        output = result.stdout
        if result.stderr:
            output += f"\nStd Error:\n{result.stderr}" if output else f"Std Error:\n{result.stderr}"
        if result.returncode != 0:
            output += f"\nExit Code: {result.returncode}" if output else f"Exit Code: {result.returncode}"
        return output if output else "(no output)"

    def read_file(self, path: str) -> str:
        resolved_path = self._resolve_existing_path(path)
        if resolved_path.exists() and not resolved_path.is_relative_to(self.root):
            raise PermissionError(f"Path escapes sandbox root: {path}")
        with resolved_path.open(encoding="utf-8") as handle:
            return handle.read()

    def list_dir(self, path: str, max_depth=2) -> list[str]:
        resolved_path = self._resolve_existing_path(path)
        if not resolved_path.is_dir():
            raise NotADirectoryError(path)

        entries: list[str] = []
        for current_root, dirs, files in os.walk(resolved_path):
            current = Path(current_root)
            rel_dir = current.relative_to(resolved_path)
            depth = 0 if str(rel_dir) == "." else len(rel_dir.parts)
            if depth >= max_depth:
                dirs[:] = []
            for dirname in sorted(dirs):
                rel_path = rel_dir / dirname
                entries.append(f"{rel_path.as_posix()}/")
            for filename in sorted(files):
                rel_path = rel_dir / filename
                entries.append(rel_path.as_posix())
        return entries

    def write_file(self, path: str, content: str, append: bool = False) -> None:
        resolved_path = self._resolve_path(path)
        resolved_parent = resolved_path.parent.resolve(strict=False)
        if not resolved_parent.is_relative_to(self.root):
            raise PermissionError(f"Path escapes sandbox root: {path}")
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with resolved_path.open(mode, encoding="utf-8") as handle:
            handle.write(content)

    def glob(
        self,
        path: str,
        pattern: str,
        *,
        include_dirs: bool = False,
        max_results: int = 200,
    ) -> tuple[list[str], bool]:
        resolved_path = self._resolve_existing_path(path)
        matches, truncated = find_glob_matches(
            resolved_path,
            pattern,
            include_dirs=include_dirs,
            max_results=max_results,
        )
        return matches, truncated

    def grep(
        self,
        path: str,
        pattern: str,
        *,
        glob: str | None = None,
        literal: bool = False,
        case_sensitive: bool = False,
        max_results: int = 100,
    ) -> tuple[list[GrepMatch], bool]:
        resolved_path = self._resolve_existing_path(path)
        return find_grep_matches(
            resolved_path,
            pattern,
            glob_pattern=glob,
            literal=literal,
            case_sensitive=case_sensitive,
            max_results=max_results,
        )

    def update_file(self, path: str, content: bytes) -> None:
        resolved_path = self._resolve_path(path)
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        with resolved_path.open("wb") as handle:
            handle.write(content)


class LocalSandboxProvider(SandboxProvider):
    """Thread-scoped LocalSandbox provider."""

    def __init__(self, root: str | Path = "/tmp/deep-research-sandboxes"):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._sandboxes: dict[str, LocalSandbox] = {}
        self._thread_to_sandbox_id: dict[str, str] = {}

    def acquire(self, thread_id: str | None = None) -> str:
        if thread_id and thread_id in self._thread_to_sandbox_id:
            return self._thread_to_sandbox_id[thread_id]

        sandbox_id = thread_id or f"sandbox-{uuid.uuid4().hex}"
        root = self.root / sandbox_id
        sandbox = LocalSandbox(id=sandbox_id, root=root)
        self._sandboxes[sandbox_id] = sandbox
        if thread_id:
            self._thread_to_sandbox_id[thread_id] = sandbox_id
        return sandbox_id

    def get(self, sandbox_id: str) -> LocalSandbox | None:
        return self._sandboxes.get(sandbox_id)

    def release(self, sandbox_id: str) -> None:
        sandbox = self._sandboxes.pop(sandbox_id, None)
        for thread_id, current_id in list(self._thread_to_sandbox_id.items()):
            if current_id == sandbox_id:
                del self._thread_to_sandbox_id[thread_id]
        if sandbox is not None and sandbox.root.is_relative_to(self.root):
            shutil.rmtree(sandbox.root, ignore_errors=True)
