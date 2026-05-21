"""Minimal local skill loader for agent prompts and tool policy."""

from __future__ import annotations

import os
import json
import re
import shutil
import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

SKILL_FILE_NAME = "SKILL.md"
SKILL_STATE_FILE_NAME = ".skill-state.json"
SAFE_SKILL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,79}$")
SAFE_TOOL_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$")

T = TypeVar("T")
_state_lock = threading.Lock()


@dataclass(frozen=True)
class AgentSkill:
    name: str
    content: str
    description: str = ""
    allowed_tools: list[str] | None = None
    enabled: bool = True
    path: Path | None = None


def default_skills_dir() -> Path:
    configured = os.getenv("AGENT_SKILLS_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[1] / "skills"


def load_enabled_skills(root: str | Path | None = None) -> list[AgentSkill]:
    return load_skills(root or default_skills_dir(), enabled_names=_enabled_skill_names())


def load_skills(
    root: str | Path,
    enabled_names: Iterable[str] | None = None,
    *,
    include_disabled: bool = False,
) -> list[AgentSkill]:
    root_path = Path(root).expanduser()
    if not root_path.exists():
        return []

    enabled = _normalized_name_set(enabled_names)
    state = _read_skill_state(root_path)
    skills: list[AgentSkill] = []
    for skill_path in _skill_paths(root_path):
        skill = _parse_skill_file(skill_path, state)
        if not include_disabled and not skill.enabled:
            continue
        if enabled is not None and skill.name not in enabled:
            continue
        skills.append(skill)
    return skills


def format_skills_for_prompt(skills: Sequence[AgentSkill]) -> str:
    if not skills:
        return ""

    blocks = ["Loaded skills. Follow these instructions when they apply:"]
    for skill in skills:
        body = skill.content.strip()
        description = skill.description.strip()
        description_line = f"\nDescription: {description}" if description else ""
        blocks.append(f'<skill name="{skill.name}">{description_line}\n{body}\n</skill>')
    return "\n\n".join(blocks)


def allowed_tool_names_for_skills(skills: Sequence[AgentSkill]) -> set[str] | None:
    allowed: set[str] = set()
    for skill in skills:
        if skill.allowed_tools is None:
            continue
        allowed.update(tool_name for tool_name in skill.allowed_tools if tool_name)
    return allowed or None


def filter_tools_by_skill_allowed_tools(tools: Sequence[T], skills: Sequence[AgentSkill]) -> list[T]:
    allowed = allowed_tool_names_for_skills(skills)
    if allowed is None:
        return list(tools)
    return [tool for tool in tools if _tool_name(tool) in allowed]


def get_skill(root: str | Path, name: str) -> AgentSkill | None:
    normalized_name = validate_skill_name(name)
    for skill in load_skills(root, include_disabled=True):
        if skill.name == normalized_name:
            return skill
    return None


def save_skill(
    root: str | Path,
    name: str,
    *,
    description: str = "",
    content: str,
    allowed_tools: Sequence[str] | None = None,
    enabled: bool | None = None,
) -> AgentSkill:
    normalized_name = validate_skill_name(name)
    root_path = Path(root).expanduser()
    skill_dir = root_path / normalized_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_path = skill_dir / SKILL_FILE_NAME
    skill_path.write_text(
        _format_skill_markdown(
            normalized_name,
            description=description,
            content=content,
            allowed_tools=list(allowed_tools or []),
        ),
        encoding="utf-8",
    )
    if enabled is not None:
        set_skill_enabled(root_path, normalized_name, enabled)
    return get_skill(root_path, normalized_name) or _parse_skill_file(skill_path, _read_skill_state(root_path))


def set_skill_enabled(root: str | Path, name: str, enabled: bool) -> AgentSkill:
    normalized_name = validate_skill_name(name)
    root_path = Path(root).expanduser()
    if not (root_path / normalized_name / SKILL_FILE_NAME).is_file():
        raise FileNotFoundError(f"Skill {normalized_name!r} not found")

    with _state_lock:
        state = _read_skill_state(root_path)
        state.setdefault("skills", {})[normalized_name] = {"enabled": bool(enabled)}
        _write_skill_state(root_path, state)

    skill = get_skill(root_path, normalized_name)
    if skill is None:
        raise FileNotFoundError(f"Skill {normalized_name!r} not found")
    return skill


def delete_skill(root: str | Path, name: str) -> bool:
    normalized_name = validate_skill_name(name)
    root_path = Path(root).expanduser()
    skill_dir = root_path / normalized_name
    skill_path = skill_dir / SKILL_FILE_NAME
    if not skill_path.exists():
        return False

    shutil.rmtree(skill_dir)
    with _state_lock:
        state = _read_skill_state(root_path)
        skills_state = state.get("skills")
        if isinstance(skills_state, dict):
            skills_state.pop(normalized_name, None)
            _write_skill_state(root_path, state)
    return True


def validate_skill_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not SAFE_SKILL_NAME.match(normalized):
        raise ValueError(
            "Skill name must start with a letter or number and contain only letters, numbers, and hyphens."
        )
    return normalized


def _enabled_skill_names() -> list[str] | None:
    value = os.getenv("AGENT_ENABLED_SKILLS", "")
    names = [part.strip() for part in value.split(",") if part.strip()]
    return names or None


def _normalized_name_set(names: Iterable[str] | None) -> set[str] | None:
    if names is None:
        return None
    normalized = {name.strip() for name in names if name.strip()}
    return normalized or set()


def _skill_paths(root: Path) -> list[Path]:
    paths: list[Path] = []
    root_skill = root / SKILL_FILE_NAME
    if root_skill.is_file():
        paths.append(root_skill)
    paths.extend(sorted(path for path in root.glob(f"*/{SKILL_FILE_NAME}") if path.is_file()))
    return paths


def _parse_skill_file(path: Path, state: dict[str, Any] | None = None) -> AgentSkill:
    text = path.read_text(encoding="utf-8")
    metadata, body = _split_skill_markdown(text)
    name = str(metadata.get("name") or path.parent.name).strip()
    return AgentSkill(
        name=name,
        description=str(metadata.get("description") or "").strip(),
        content=body.strip(),
        allowed_tools=_metadata_list(metadata.get("allowed_tools")),
        enabled=_skill_enabled_from_state(state or {}, name),
        path=path,
    )


def _split_skill_markdown(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text.strip()

    end_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_index = index
            break

    if end_index is None:
        return {}, text.strip()

    metadata = _parse_frontmatter(lines[1:end_index])
    body = "\n".join(lines[end_index + 1 :]).strip()
    return metadata, body


def _parse_frontmatter(lines: Sequence[str]) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    current_key: str | None = None

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if raw_line[:1].isspace() and current_key and stripped.startswith("- "):
            value = _unquote(stripped[2:].strip())
            current_value = metadata.setdefault(current_key, [])
            if isinstance(current_value, list):
                current_value.append(value)
            continue

        if ":" not in raw_line:
            continue

        key, value = raw_line.split(":", 1)
        current_key = key.strip().replace("-", "_").lower()
        value = value.strip()
        if not value:
            metadata[current_key] = []
            continue
        metadata[current_key] = _parse_scalar_or_inline_list(value)

    return metadata


def _parse_scalar_or_inline_list(value: str) -> str | list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_unquote(part.strip()) for part in inner.split(",") if part.strip()]
    return _unquote(value)


def _metadata_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list):
        items = value
    else:
        items = str(value).split(",")

    normalized = [_unquote(str(item).strip()) for item in items]
    normalized = [item for item in normalized if item]
    return normalized or None


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _tool_name(tool: Any) -> str | None:
    if isinstance(tool, dict):
        value = tool.get("name")
    else:
        value = getattr(tool, "name", None)
    return str(value) if value else None


def _skill_enabled_from_state(state: dict[str, Any], name: str) -> bool:
    skills_state = state.get("skills")
    if not isinstance(skills_state, dict):
        return True
    entry = skills_state.get(name)
    if not isinstance(entry, dict):
        return True
    enabled = entry.get("enabled")
    return bool(enabled) if isinstance(enabled, bool) else True


def _read_skill_state(root: Path) -> dict[str, Any]:
    path = _skill_state_file(root)
    if not path.exists():
        return {"skills": {}}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"skills": {}}
    return state if isinstance(state, dict) else {"skills": {}}


def _write_skill_state(root: Path, state: dict[str, Any]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    _skill_state_file(root).write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _skill_state_file(root: Path) -> Path:
    configured = os.getenv("AGENT_SKILLS_STATE_FILE")
    if configured:
        return Path(configured).expanduser()
    return root / SKILL_STATE_FILE_NAME


def _format_skill_markdown(
    name: str,
    *,
    description: str,
    content: str,
    allowed_tools: Sequence[str],
) -> str:
    lines = [
        "---",
        f"name: {_single_line(name)}",
        f"description: {_single_line(description)}",
    ]
    normalized_tools = [_validate_tool_name(tool) for tool in allowed_tools]
    if normalized_tools:
        lines.append("allowed_tools:")
        lines.extend(f"  - {tool_name}" for tool_name in normalized_tools)
    lines.extend(["---", "", content.strip(), ""])
    return "\n".join(lines)


def _single_line(value: str) -> str:
    return " ".join(str(value or "").split())


def _validate_tool_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not SAFE_TOOL_NAME.match(normalized):
        raise ValueError("Tool name must contain only letters, numbers, underscores, and hyphens.")
    return normalized
