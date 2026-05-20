from typing import Any, Callable

from runtime_sandbox.sandbox.sandbox import Sandbox
from runtime_sandbox.sandbox.sandbox_provider import SandboxProvider


SandboxToolResult = dict[str, Any]


def sandbox_tool_specs() -> list[dict[str, Any]]:
    """Return tool metadata suitable for exposing sandbox capabilities to agents."""
    return [
        {
            "name": "bash",
            "description": "Execute a shell command inside the sandbox workspace.",
            "parameters": {
                "command": "Shell command to execute.",
            },
        },
        {
            "name": "read_file",
            "description": "Read a UTF-8 text file from the sandbox workspace.",
            "parameters": {
                "path": "Absolute or sandbox-relative file path.",
            },
        },
        {
            "name": "write_file",
            "description": "Write UTF-8 text content to a file in the sandbox workspace.",
            "parameters": {
                "path": "Absolute or sandbox-relative file path.",
                "content": "Text content to write.",
                "append": "Whether to append instead of overwrite.",
            },
        },
        {
            "name": "list_dir",
            "description": "List directory entries in the sandbox workspace.",
            "parameters": {
                "path": "Absolute or sandbox-relative directory path.",
                "max_depth": "Maximum traversal depth.",
            },
        },
        {
            "name": "glob",
            "description": "Find files matching a glob pattern under a sandbox directory.",
            "parameters": {
                "path": "Absolute or sandbox-relative root directory.",
                "pattern": "Glob pattern, for example **/*.py.",
                "include_dirs": "Whether directory matches should be included.",
                "max_results": "Maximum number of matches to return.",
            },
        },
        {
            "name": "grep",
            "description": "Search text files in the sandbox workspace.",
            "parameters": {
                "path": "Absolute or sandbox-relative root directory.",
                "pattern": "Regex or literal text pattern.",
                "glob": "Optional file glob filter, for example **/*.py.",
                "literal": "Treat pattern as literal text instead of regex.",
                "case_sensitive": "Whether matching is case-sensitive.",
                "max_results": "Maximum number of matches to return.",
            },
        },
    ]


def sandbox_openai_tool_specs() -> list[dict[str, Any]]:
    """Return OpenAI-compatible function tool schemas for sandbox tools."""
    return [
        _function_tool(
            "bash",
            "Execute a shell command inside the sandbox workspace.",
            {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute.",
                },
            },
            ["command"],
        ),
        _function_tool(
            "read_file",
            "Read a UTF-8 text file from the sandbox workspace.",
            {
                "path": {
                    "type": "string",
                    "description": "Absolute or sandbox-relative file path.",
                },
            },
            ["path"],
        ),
        _function_tool(
            "write_file",
            "Write UTF-8 text content to a file in the sandbox workspace.",
            {
                "path": {
                    "type": "string",
                    "description": "Absolute or sandbox-relative file path.",
                },
                "content": {
                    "type": "string",
                    "description": "Text content to write.",
                },
                "append": {
                    "type": "boolean",
                    "description": "Whether to append instead of overwrite.",
                },
            },
            ["path", "content"],
        ),
        _function_tool(
            "list_dir",
            "List directory entries in the sandbox workspace.",
            {
                "path": {
                    "type": "string",
                    "description": "Absolute or sandbox-relative directory path.",
                },
                "max_depth": {
                    "type": "integer",
                    "description": "Maximum traversal depth.",
                },
            },
            ["path"],
        ),
        _function_tool(
            "glob",
            "Find files matching a glob pattern under a sandbox directory.",
            {
                "path": {
                    "type": "string",
                    "description": "Absolute or sandbox-relative root directory.",
                },
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern, for example **/*.py.",
                },
                "include_dirs": {
                    "type": "boolean",
                    "description": "Whether directory matches should be included.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of matches to return.",
                },
            },
            ["path", "pattern"],
        ),
        _function_tool(
            "grep",
            "Search text files in the sandbox workspace.",
            {
                "path": {
                    "type": "string",
                    "description": "Absolute or sandbox-relative root directory.",
                },
                "pattern": {
                    "type": "string",
                    "description": "Regex or literal text pattern.",
                },
                "glob": {
                    "type": "string",
                    "description": "Optional file glob filter, for example **/*.py.",
                },
                "literal": {
                    "type": "boolean",
                    "description": "Treat pattern as literal text instead of regex.",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Whether matching is case-sensitive.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of matches to return.",
                },
            },
            ["path", "pattern"],
        ),
    ]


class SandboxToolRunner:
    """Execute named sandbox tools against sandboxes from a provider."""

    def __init__(self, provider: SandboxProvider):
        self.provider = provider
        self._handlers: dict[str, Callable[[Sandbox, dict[str, Any]], SandboxToolResult]] = {
            "bash": self._run_bash,
            "read_file": self._run_read_file,
            "write_file": self._run_write_file,
            "list_dir": self._run_list_dir,
            "glob": self._run_glob,
            "grep": self._run_grep,
        }

    def run(self, sandbox_id: str, tool_name: str, arguments: dict[str, Any]) -> SandboxToolResult:
        sandbox = self.provider.get(sandbox_id)
        if sandbox is None:
            return _error_result(f"Sandbox not found: {sandbox_id}")

        handler = self._handlers.get(tool_name)
        if handler is None:
            return _error_result(f"Unknown sandbox tool: {tool_name}")

        try:
            return handler(sandbox, arguments)
        except Exception as exc:
            return _error_result(f"{type(exc).__name__}: {exc}")

    def _run_bash(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        command = _required_string(arguments, "command")
        return _content_result(sandbox.execute_command(command))

    def _run_read_file(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        path = _required_string(arguments, "path")
        return _content_result(sandbox.read_file(path))

    def _run_write_file(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        path = _required_string(arguments, "path")
        content = str(arguments.get("content", ""))
        append = bool(arguments.get("append", False))
        sandbox.write_file(path, content, append=append)
        return _content_result("")

    def _run_list_dir(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        path = _required_string(arguments, "path")
        max_depth = int(arguments.get("max_depth", 2))
        return {
            "ok": True,
            "entries": sandbox.list_dir(path, max_depth=max_depth),
        }

    def _run_glob(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        path = _required_string(arguments, "path")
        pattern = _required_string(arguments, "pattern")
        matches, truncated = sandbox.glob(
            path,
            pattern,
            include_dirs=bool(arguments.get("include_dirs", False)),
            max_results=int(arguments.get("max_results", 200)),
        )
        return {
            "ok": True,
            "matches": matches,
            "truncated": truncated,
        }

    def _run_grep(self, sandbox: Sandbox, arguments: dict[str, Any]) -> SandboxToolResult:
        path = _required_string(arguments, "path")
        pattern = _required_string(arguments, "pattern")
        matches, truncated = sandbox.grep(
            path,
            pattern,
            glob=arguments.get("glob"),
            literal=bool(arguments.get("literal", False)),
            case_sensitive=bool(arguments.get("case_sensitive", False)),
            max_results=int(arguments.get("max_results", 100)),
        )
        return {
            "ok": True,
            "matches": [
                {
                    "path": match.path,
                    "line_number": match.line_number,
                    "line": match.line,
                }
                for match in matches
            ],
            "truncated": truncated,
        }


def _required_string(arguments: dict[str, Any], name: str) -> str:
    value = arguments.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing required string argument: {name}")
    return value


def _content_result(content: str) -> SandboxToolResult:
    return {
        "ok": True,
        "content": content,
    }


def _error_result(message: str) -> SandboxToolResult:
    return {
        "ok": False,
        "error": message,
    }


def _function_tool(
    name: str,
    description: str,
    properties: dict[str, Any],
    required: list[str],
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }
